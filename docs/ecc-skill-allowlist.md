# ECC skill bị cắt khỏi prompt — đo theo log và theo ý định

Cập nhật: 2026-11-01 · số liệu từ `tools/prompt-budget.mjs` và 602 file session trong `~/.dsh/sessions`

## 1. Con số

| Hạng mục | Giá trị |
|---|---|
| Inventory ECC | 311 skill |
| Policy duyệt (`include`) | 268 skill |
| Allowlist đang nạp | 20 skill |
| Bị bỏ khỏi prompt | 290 tên (289 unique + 1 trùng) |
| Ký tự name+description trước / sau | 84.858 / 5.796 |
| Tiết kiệm mỗi request | ≈19.766 token |


## 2. Bằng chứng theo LOG (máy đo được)

- Quét 602 session: **92 skill từng được gọi**, 22 trong đó là ECC — cả 22 đều nằm trong allowlist.

- **0/290** skill bị cắt từng được gọi lần nào trong toàn bộ log.

- Kết luận theo log: cắt không mất năng lực đã dùng.


## 3. Bằng chứng theo Ý ĐỊNH (log không trả lời được)

- Đối chiếu mọi skill mà tài liệu workspace yêu cầu: `AGENTS.md` §6 (`four-phase-env-setup` → `four-phase-product-plan` → `four-phase-tech-plan` → `implement`, `systematic-debugging`, `handoff`, `retro`, `code-review`), cùng `vibe-code`, `impeccable`, `gsap-core`, `webapp-testing`, `prompt-intake`, `verification-before-completion` — **tất cả vẫn có trong catalog live (131 skill)**.

- Quét 290 tên bị cắt trong `AGENTS.md`, `docs/**/*.md`, `tools/**`: 32 lần nhắc, **không lần nào là yêu cầu bắt buộc** — nằm trong `docs/ecc-skill-matrix.md` (bảng kiểm kê) và `docs/ecc-integration-research.md` (nghiên cứu), phần còn lại là chữ thường ("benchmark", "taste").

- Nói thẳng giới hạn: log **không** biết tháng sau bạn làm gì. Skill chưa từng gọi vẫn có thể đúng việc tiếp theo — nên mục 4 để bạn chỉ tay, mục 5 để lấy lại trong 30 giây.


## 4. 290 skill bị bỏ, nhóm theo lĩnh vực

### Quy trình, tài liệu & tích hợp (60)

`ai-first-engineering`, `article-writing`, `blueprint`, `brownfield-retrospective`, `code-tour`, `codebase-onboarding`, `coding-standards`, `competitive-platform-analysis`, `competitive-report-structure`, `connections-optimizer`, `contract-first`, `cost-tracking`, `customer-billing-ops`, `deep-research`, `dev-team`, `dmux-workflows`, `docs-governance`, `dynamic-workflow-mode`, `ecc-guide`, `ecc-recipes`, `email-ops`, `exa-search`, `fal-ai-media`, `finance-billing-ops`, `git-workflow`, `github-ops`, `google-workspace-ops`, `i18n-sync`, `inherit-legacy-style`, `inventory-demand-planning`, `ito-baskets`, `ito-compute`, `ito-inference`, `ito-training`, `jira-integration`, `living-docs-governance`, `mailtrap-email-integration`, `market-research`, `mcp-server-patterns`, `messages-ops`, `orch-add-feature`, `orch-build-mvp`, `orch-change-feature`, `orch-pipeline`, `orch-refine-code`, `parallel-execution-optimizer`, `plan-canvas`, `plan-orchestrate`, `prediction-market-oracle-research`, `product-capability`, `product-lens`, `project-flow-ops`, `research-ops`, `search-first`, `story-lifecycle`, `team-builder`, `terminal-opener`, `unified-notifications-ops`, `videodb`, `visa-doc-translate`

### AI agent & LLM (47)

`agent-architecture-audit`, `agent-payment-x402`, `agent-sort`, `agentic-engineering`, `agentic-os`, `autonomous-agent-harness`, `autonomous-loops`, `claude-devfleet`, `context-and-decisions`, `context-budget`, `continuous-agent-loop`, `continuous-learning`, `continuous-learning-v2`, `cost-aware-llm-pipeline`, `council`, `council-multi-model`, `data-scraper-agent`, `enterprise-agent-ops`, `eval-harness`, `evm-token-decimals`, `foundation-models-on-device`, `gan-style-harness`, `healthcare-eval-harness`, `hermes-imports`, `iterative-retrieval`, `knowledge-ops`, `llm-trading-agent-security`, `ml-adoption-playbook`, `mle-workflow`, `nanoclaw-repl`, `openclaw-persona-forge`, `prompt-caching-strategy`, `prompt-optimizer`, `pytorch-patterns`, `recsys-pipeline-architect`, `recursive-decision-ledger`, `regex-vs-llm-structured-text`, `santa-method`, `skill-comply`, `skill-host-compat`, `skill-scout`, `skill-stocktake`, `strategic-compact`, `team-agent-orchestration`, `token-budget-advisor`, `token-card`, `unified-memory`

### Ngôn ngữ & backend (39)

`agent-runtime-gateway-smoke-test`, `bun-runtime`, `cpp-coding-standards`, `cpp-testing`, `csharp-testing`, `django-celery`, `django-patterns`, `django-security`, `django-tdd`, `django-verification`, `dotnet-patterns`, `fastapi-patterns`, `fsharp-testing`, `generating-python-installer`, `golang-patterns`, `golang-testing`, `java-coding-standards`, `jpa-patterns`, `laravel-patterns`, `laravel-plugin-discovery`, `laravel-security`, `laravel-tdd`, `laravel-verification`, `mybatis-patterns`, `nestjs-patterns`, `nodejs-keccak256`, `perl-patterns`, `perl-security`, `perl-testing`, `python-patterns`, `python-testing`, `quarkus-patterns`, `quarkus-security`, `quarkus-tdd`, `quarkus-verification`, `rails-patterns`, `rust-patterns`, `rust-testing`, `tinystruct-patterns`

### Nghiệp vụ, khoa học & tài liệu (30)

`bengali-nlp`, `brand-discovery`, `brand-voice`, `carrier-relationship-management`, `content-engine`, `content-hash-cache-pattern`, `crosspost`, `data-throughput-accelerator`, `energy-procurement`, `esign-field-placement`, `growth-log`, `healthcare-cdss-patterns`, `healthcare-emr-patterns`, `investor-materials`, `investor-outreach`, `lead-intelligence`, `logistics-exception-management`, `marketing-campaign`, `master-agreement-generator`, `nutrient-document-processing`, `opensource-pipeline`, `osint-investigation`, `production-scheduling`, `ralphinho-rfc-pipeline`, `returns-reverse-logistics`, `scientific-pkg-gget`, `scientific-thinking-scholar-evaluation`, `seo`, `social-graph-ranker`, `social-publisher`

### Web / API / kiến trúc ứng dụng (21)

`angular-developer`, `api-connector-builder`, `api-design`, `design-system`, `frontend-design-direction`, `frontend-slides`, `hexagonal-architecture`, `liquid-glass-design`, `loop-design-check`, `make-interfaces-feel-better`, `react-performance`, `react-testing`, `springboot-patterns`, `springboot-security`, `springboot-tdd`, `springboot-verification`, `ui-demo`, `ui-to-vue`, `vite-patterns`, `vue-patterns`, `x-api`

### Kiểm thử & chất lượng (20)

`ai-regression-testing`, `benchmark`, `benchmark-methodology`, `benchmark-optimization-loop`, `browser-qa`, `codehealth-mcp`, `delivery-gate`, `e2e-testing`, `hookify-rules`, `mcp-dependency-review`, `module-regression`, `orch-fix-defect`, `plankton-code-quality`, `prediction-market-risk-review`, `quality-nonconformance`, `repo-scan`, `rules-distill`, `scientific-thinking-literature-review`, `tdd-workflow`, `verification-loop`

### Hạ tầng / vận hành (17)

`canary-watch`, `dashboard-builder`, `deployment-patterns`, `docker-patterns`, `flox-environments`, `homelab-network-readiness`, `homelab-network-setup`, `homelab-pihole-dns`, `homelab-vlan-segmentation`, `homelab-wireguard-vpn`, `kubernetes-patterns`, `latency-critical-systems`, `nasiko-control-plane`, `netmiko-ssh-automation`, `network-bgp-diagnostics`, `network-interface-health`, `uncloud`

### Mobile & app desktop (17)

`android-clean-architecture`, `cisco-ios-patterns`, `compose-multiplatform-patterns`, `dart-flutter-patterns`, `flutter-dart-code-review`, `ios-icon-gen`, `kotlin-coroutines-flows`, `kotlin-exposed-patterns`, `kotlin-ktor-patterns`, `kotlin-patterns`, `kotlin-testing`, `react-native-patterns`, `swift-actor-persistence`, `swift-concurrency-6-2`, `swift-protocol-di-testing`, `swiftui-patterns`, `windows-desktop-e2e`

### Bảo mật & tuân thủ (13)

`click-path-audit`, `counterparty-channel-discipline`, `customs-trade-compliance`, `defi-amm-security`, `ecc-tools-cost-audit`, `gateguard`, `healthcare-phi-compliance`, `hipaa-compliance`, `operator-approval-loop`, `safety-guard`, `security-bounty-hunter`, `security-scan`, `workspace-surface-audit`

### Sáng tạo / media (11)

`blender-motion-state-inspection`, `manim-video`, `motion-advanced`, `motion-foundations`, `motion-patterns`, `remotion-video-creation`, `taste`, `taste-application`, `taste-distillation`, `tasteforge-video`, `video-editing`

### CSDL / cấu hình (10)

`clickhouse-io`, `config-gc`, `database-migrations`, `mysql-patterns`, `network-config-validation`, `postgres-patterns`, `prisma-patterns`, `redis-patterns`, `scientific-db-pubmed-database`, `scientific-db-uspto-database`

### Khác (tiện ích lẻ) (4)

`architecture-decision-records`, `ck`, `error-handling`, `nuxt4-patterns`


## 5. Lấy lại một skill (không cần restart)

Mở `~/.dsh/profiles/web/cordis.patch.yml`, block `- id: dsh-ecc-adapter`, thêm tên vào `skillAllowlist:` — phải là skill **đã được policy duyệt** (trong 268 tên; tên ngoài policy sẽ hiện ở `skills.allowlist.unknown` của `/ecc-status`). DSH nạp lại danh mục ngay trong phiên, không cần khởi động lại. Bỏ hẳn key `skillAllowlist` = quay về đủ 268 skill.


## 6. Nếu làm các việc sau thì lấy lại trước

| Việc | Skill nên thêm lại |
|---|---|
| App điện thoại (React Native / Expo) | `react-native-patterns`, `expo-router`, `mobile-*` |
| Backend Python (Django/FastAPI) | `django-patterns`, `django-tdd`, `django-security`, `fastapi-patterns`, `python-patterns`, `python-testing` |
| Deploy / hạ tầng | `kubernetes-patterns`, `deployment-patterns`, `observability-and-instrumentation`, `ci-cd-and-automation` |
| Viết báo cáo/tài liệu dài | `doc-coauthoring`, `docs-governance`, `living-docs-governance` |
| Test nghiêm hơn | `python-testing`, `react-testing`, `golang-testing`, `tdd-workflow` |
| Bot / AI agent tự động | `agent-eval`, `autonomous-loops`, `agent-harness-construction`, `context-engineering` |

