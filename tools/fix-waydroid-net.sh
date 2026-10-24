#!/bin/bash
# fix-waydroid-net.sh
# Sua Waydroid khong co internet khi ufw dang bat tren Arch/Omarchy.
#
# NGUYEN NHAN GOC:
#   ufw hook chain "filter" o priority -1 voi DEFAULT_FORWARD_POLICY="DROP",
#   nen goi forward bi drop TRUOC khi chain "inet lxc" cua waydroid
#   (hook filter priority 0) kip accept, va NAT masquerade (priority 100)
#   khong bao gio chay.
#
# CACH SUA:
#   Doi DEFAULT_FORWARD_POLICY sang ACCEPT. An toan vi:
#   - DEFAULT_INPUT_POLICY van la DROP  -> may khong bi mo cong vao
#   - Forward chi anh huong goi DI QUA may, khong phai goi TOI may
#
# Chay:  sudo bash fix-waydroid-net.sh

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "LOI: phai chay bang root:  sudo bash $0" >&2
  exit 1
fi

echo "== 1. Bat IP forwarding =="
sysctl -w net.ipv4.ip_forward=1

echo
echo "== 2. Cho phep ufw forward =="
if grep -q '^DEFAULT_FORWARD_POLICY="DROP"' /etc/default/ufw; then
  cp -a /etc/default/ufw "/etc/default/ufw.bak.$(date +%s)"
  sed -i 's/^DEFAULT_FORWARD_POLICY="DROP"/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
  echo "   da sua /etc/default/ufw (co backup .bak.*)"
else
  echo "   khong con la DROP -> bo qua"
fi

echo
echo "== 3. Reload ufw =="
ufw reload

echo
echo "== 4. Kiem tra chain lxc cua waydroid =="
echo "--- inet lxc (filter forward) ---"
nft list table inet lxc 2>&1 | head -20
echo "--- ip lxc (nat masquerade) ---"
nft list table ip lxc 2>&1 | head -10

echo
echo "== 5. Restart container de waydroid-net.sh chay lai =="
waydroid session stop 2>/dev/null || true
systemctl restart waydroid-container.service
sleep 5
echo -n "container service: "
systemctl is-active waydroid-container.service

echo
echo "== 6. Xac nhan cau hinh =="
grep '^DEFAULT_FORWARD_POLICY' /etc/default/ufw
sysctl -n net.ipv4.ip_forward

echo
echo "== 7. Trang thai Waydroid =="
waydroid status 2>&1 | head -5

echo
echo "XONG. Mo Waydroid va kiem tra internet."
echo "Neu van khong co internet, chay lai script nay va gui toan bo output."