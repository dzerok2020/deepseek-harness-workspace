#!/usr/bin/env python3
"""So khớp ngân sách model trong profile với tham chiếu Git — chỉ đọc.

Tách khỏi chuỗi ChatGPT Web: lệch ngân sách KHÔNG có nghĩa shim/bridge hỏng.
In mỗi dòng lệch dạng 'LỖI: <model>: ...'; thoát 0 khi khớp.
"""
import os
import sys

from model_budgets import check_profile_budgets

DEFAULT_PROFILE = '~/.dsh/profiles/web/cordis.patch.yml'


def main():
    path = os.environ.get('DSH_WEB_CORDIS', DEFAULT_PROFILE)
    path = os.path.expanduser(path)
    if not os.path.exists(path):
        print('LỖI: profile: khong thay file ' + path)
        return 1
    drift = check_profile_budgets(path)
    for line in drift:
        print('LỖI: profile: ' + line)
    if not drift:
        print('ĐẠT: ngân sách context/maxTokens của provider or/cgw khớp tham chiếu Git')
    return bool(drift)


if __name__ == '__main__':
    sys.exit(main())
