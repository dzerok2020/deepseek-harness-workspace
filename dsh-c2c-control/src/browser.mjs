import puppeteer from 'puppeteer-core';
import { mkdir, readdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const origins = new Set(['https://chatgpt.com', 'https://auth.openai.com', 'https://auth0.openai.com']);
export function allowedUrl(value) {
 try { const url = new URL(value); return !url.username && !url.password && origins.has(url.origin); }
 catch { return false; }
}
const editorSelector = '#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, textarea#pending-home-input';
/** Owns one Chromium process. Does not attach to user browsers or export credentials. */
export class OwnedBrowser {
 constructor({ profileDir, executablePath }) {
  if (!path.isAbsolute(profileDir) || !path.isAbsolute(executablePath)) throw new Error('Absolute paths required');
  this.profileDir = profileDir; this.executablePath = executablePath;
  this.browser = null; this.page = null; this.generation = 0;
  this.launch = options => puppeteer.launch(options);
 }
 status() { return { running: !!this.browser?.connected, url: this.page?.url() ?? null }; }
 async open(url = 'https://chatgpt.com/', signal) {
  if (!allowedUrl(url)) throw new Error('URL outside browser allowlist');
  signal?.throwIfAborted();
  const generation = this.generation;
  try {
  if (!this.browser?.connected) {
   await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
   if (await realpath(this.profileDir) !== this.profileDir) throw new Error('Profile path cannot contain symlinks');
   const marker = path.join(this.profileDir, '.dsh-c2c-owned');
   const files = await readdir(this.profileDir);
   if (files.length && !files.includes('.dsh-c2c-owned')) throw new Error('Refuse existing non-owned browser profile');
   if (!files.length) await writeFile(marker, 'dsh-c2c-control-v1\n', { mode: 0o600, flag: 'wx' });
   if (await readFile(marker, 'utf8') !== 'dsh-c2c-control-v1\n') throw new Error('Invalid ownership marker');
   const launched = await this.launch({ executablePath: this.executablePath, userDataDir: this.profileDir, headless: false, defaultViewport: null, args: ['--no-first-run', '--no-default-browser-check'] });
   if (this.generation !== generation) { await launched.close(); throw new Error('Browser closed during launch'); }
   this.browser = launched;
   if (signal?.aborted) { await this.close(); signal.throwIfAborted(); }
   this.page = await this.browser.newPage();
   // Never silently follow unknown redirects. Login/CAPTCHA is human-owned.
   await this.page.setRequestInterception(true);
   this.page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === this.page?.mainFrame() && !allowedUrl(request.url())) void request.abort().catch(() => {});
    else void request.continue().catch(() => {});
   });
  }
  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, signal });
  signal?.throwIfAborted();
  return this.status();
  } catch (error) { await this.close(); throw error; }
 }
 assertPage() {
  if (!this.browser?.connected || !this.page || this.page.isClosed()) throw new Error('Browser not running');
  if (!allowedUrl(this.page.url())) throw new Error('Browser outside allowlist');
 }
 async inspect(signal) {
  signal?.throwIfAborted(); this.assertPage();
  const result = await this.page.evaluate((selector) => {
   const visible = element => !!(element && element.getClientRects().length);
   const editor = document.querySelector(selector);
   const messages = [...document.querySelectorAll('[data-message-author-role]')].slice(-30).map(el => ({ role: el.getAttribute('data-message-author-role'), text: (el.innerText ?? '').slice(0, 12000) }));
   return { editorReady: visible(editor), generating: visible(document.querySelector('[data-testid="stop-button"]')), messages };
  }, editorSelector);
  signal?.throwIfAborted();
  return { ...this.status(), ...result };
 }
 async send(text, signal) {
  if (typeof text !== 'string' || Buffer.byteLength(text) >= 1024) throw new Error('Message exceeds control-plane limit');
  let dispatching = false;
   let ownedEditor;
  try {
  const observed = await this.inspect(signal);
  if (!observed.editorReady || observed.generating || new URL(observed.url).origin !== 'https://chatgpt.com') throw new Error('PAUSED: login, challenge, generation or editor not ready');
  const editor = await this.page.$(editorSelector);
  const existing = await editor.evaluate(el => el.value ?? el.innerText ?? '');
  if (existing.trim()) throw new Error('PAUSED: composer contains a draft; no overwrite');
  signal?.throwIfAborted();
  await editor.focus();
  ownedEditor = editor;
   await this.page.keyboard.insertText(text);
  const actual = await editor.evaluate(el => el.value ?? el.innerText ?? '');
  if (actual.trim() !== text.trim()) throw new Error('PAUSED: draft verification failed');
  signal?.throwIfAborted();
  const button = await this.page.$('button[data-testid="send-button"]');
  if (!button || await button.evaluate(el => el.disabled)) throw new Error('PAUSED: send button unavailable');
  signal?.throwIfAborted();
  this.assertPage();
  if (this.page.url() !== observed.url) throw new Error('PAUSED: conversation changed before submission');
  dispatching = true;
  await button.click();
  // Submission is verified by controller against actual user-message history.
  } catch (error) {
   if (!dispatching) {
     error.submission = 'not-submitted';
     // Clear only our exact draft, never concurrent human edits.
     if (ownedEditor) await ownedEditor.evaluate((el, expected) => {
      if ((el.value ?? el.innerText ?? '').trim() !== expected.trim()) return;
      if ('value' in el) el.value = ''; else el.textContent = '';
      el.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'deleteContentBackward'}));
     }, text).catch(() => {});
    }
   throw error;
  }
 }
 async close() {
  this.generation++;
   const browser = this.browser; this.browser = null; this.page = null;
  if (browser) await browser.close();
 }
}
