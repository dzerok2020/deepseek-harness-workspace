# Đánh giá Harness² trước khi cân nhắc dùng với DeepSeek Harness

## 1. Kết luận cho người đang dùng DSH

**Chưa nên cài Harness² vào DeepSeek Harness (DSH) hiện tại.** Ở bản khảo sát, đây là một framework nghiên cứu chạy benchmark và tối ưu lớp điều khiển quanh model, có executor OpenCode/Codex; không phải gói plugin DSH có thể cài trực tiếp. Nguồn đóng gói khai báo package Python `harness2` cùng các CLI Python, còn các adapter executor chính thức là `oc` và `cx`. Đây là kết luận từ phạm vi tích hợp đang có, không phải khẳng định không thể tự viết adapter DSH trong tương lai. [Đóng gói Python][packaging] · [OpenCode substrate][oc] · [Codex substrate][cx] · [Toàn bộ cây nguồn khảo sát][tree]

**Lý do chính để hoãn:** executor không bị hạn chế mạng trong bản phát hành; Codex chạy với sandbox bị tắt. Sandbox là lớp giới hạn những gì chương trình được phép làm với máy và dữ liệu. Tài liệu còn cảnh báo kết quả benchmark có thể bị nhiễm vì agent truy cập rubric công khai trên mạng. Vì vậy không nên gắn thử vào workspace, thông tin đăng nhập hay dữ liệu làm việc thật chỉ vì tên có chữ “harness”. [README: web access][readme-web] · [Cảnh báo và biện pháp mạng][experiments-web] · [Cờ Codex][cx]

Nếu muốn nghiên cứu tiếp, nên xem đây là **thí nghiệm riêng**, dùng máy/VM dùng một lần, dữ liệu không nhạy cảm, chính sách mạng và ngân sách API được duyệt trước; không thay thế cấu hình DSH đang dùng. Đây là **khuyến nghị của báo cáo**, suy ra từ rủi ro và phạm vi tích hợp ở trên, không phải hướng dẫn cài đặt chính thức. Phiên này chỉ đọc nguồn và viết tài liệu; **không cài dependency, không chạy mã remote, không gọi model của Harness², không sửa cấu hình DSH**.

## 2. Phạm vi và độ chắc chắn của khảo sát

- Thời điểm khảo sát: **22/10/2026**, múi giờ Asia/Saigon.
- Repository chính thức: [google-research/harness2](https://github.com/google-research/harness2).
- Commit đã ghim: **`1cfe254e8d25b15f37048c3730134686abe60335`**, thời gian committer **2026-10-14T02:22:49Z**. Mọi permalink trong báo cáo đều trỏ đến commit này. [Commit][commit]
- Phương pháp: dùng **GitHub CLI `gh api`** để đọc metadata, recursive tree, README, hướng dẫn setup/experiment và code/config chính thức; không dựa vào bài tổng hợp bên thứ ba.
- Đây là **đánh giá tĩnh**: đọc code để hiểu hành vi dự kiến, không phải chứng nhận đã chạy thành công hay kiểm toán bảo mật đầy đủ.
- Dòng README “plug-and-play” không chứng minh tương thích với DSH. Tài liệu giới thiệu executor OpenCode/Codex và ba benchmark, không đưa ra quy trình cài plugin DSH. [README][readme] · [Đóng gói][packaging] · [Cây nguồn][tree]

## 3. Mục đích: tối ưu harness, không huấn luyện lại model

“Harness” là hệ thống bao quanh model giúp nó hoạt động như agent: prompt, tool, memory, skill và orchestration (cách điều phối các bước hoặc agent). Harness² nghiên cứu **recursive agent harnessing**: dùng agent để cải tiến chính lớp hệ thống đó cho những tác vụ chưa thấy lúc thiết kế, trong khi **giữ nguyên trọng số model**. Vì vậy đây không phải fine-tuning model và cũng không phải một model AI mới. [README: định nghĩa và hai mức recursion][readme]

README nêu hai mức:

1. **Task-level recursion:** trên cùng tác vụ, đề xuất chỉnh harness, chạy thử để quan sát sự khác nhau, rồi kết hợp thành harness cải tiến theo chu trình **Propose–Probe–Compose**, không dùng ground-truth feedback trong bước cải tiến.
2. **Harnessing-level recursion:** sau mỗi tác vụ, lưu harness được chọn và bài học có bằng chứng vào improvement harness/library để hỗ trợ tác vụ về sau.

Đó là mô tả phương pháp của tác giả, không có nghĩa agent tự sửa model hay tự nâng cấp DSH đang chạy. [README][readme] · [Recursion modes và library][experiments]

README báo cáo mức tăng tối đa 11,5 điểm trên WorkBuddy-Bench, 4,5 điểm trên JobBench và 11,8 điểm phần trăm partial pass rate trên LAB, qua các cấu hình GLM-5/Gemini 3.5 Flash. **Đây là kết quả tác giả công bố**, không phải kết quả được tái lập trong khảo sát này, và không đủ để suy ra DSH hiện tại sẽ tốt hơn tương ứng. Cảnh báo mạng/rubric ở mục bảo mật cũng cần đi cùng khi diễn giải các con số. [README: kết quả][readme] · [Web access khi đánh giá][experiments-web]

## 4. Kiến trúc và bề mặt chỉnh sửa

### 4.1. Các lớp chính

| Lớp | Vai trò và bằng chứng |
| --- | --- |
| CLI | `harness2` chạy sweep; các lệnh riêng cho setup, check, judge, report, demo và bridge. Entry point được khai báo trong package Python. [Nguồn][packaging] |
| Core recursion | Tổ chức đề xuất invariant/general và domain-specific, chạy candidate, compose, retry proposal không hợp lệ rồi fallback. [Nguồn][recursion] |
| Selection và reflection | Chọn đầu ra cuối, phản ánh trên harness edit/trajectory/deliverable rồi chắt lọc bài học. [Nguồn][selection] |
| Editable tree | Biểu diễn harness bằng các file văn bản, kiểm tra đường dẫn, frontmatter, giới hạn nội dung, script và schema hook. [Nguồn][validation] |
| Substrate/executor | Adapter biến harness thành cấu hình dùng được bởi OpenCode hoặc Codex rồi giao cho launcher của benchmark thực thi. [OpenCode][oc] · [Codex][cx] |
| Benchmark adapter | Bản phát hành hỗ trợ JobBench, LAB và WorkBuddy-Bench; mỗi benchmark có setup, môi trường và grading riêng. [README][readme] · [Setup][setup] |

### 4.2. Tám thành phần có thể tối ưu

README liệt kê **system prompt, guardrails, memory, tool guidance, subagents, skills, scripts và plugins**. Những thành phần này điều khiển context, giao diện tool, delegation và hành vi trong tool loop. [README: Harness components][readme]

Cách hiện thực phụ thuộc executor:

- **OpenCode:** các file always-on gồm `systemprompt.md`, `guardrails.md`, `LongTermMEMORY.md`, `tool_descriptions/tool_guidance.md`; có `skills`, `sub_agents`, script Python và plugin TypeScript. Có ba install mode `workspace_agents_md`, `home_dir_jinja`, `workspace_config` dành cho cách runner của các benchmark nhận harness. Đây là cơ chế triển khai harness vào task workspace/container, không phải cài plugin DSH. [OpenCode surface và materialise][oc]
- **Codex:** always-on là `AGENTS.md`; skill dưới `.agents/skills`; hook tại `.codex/hooks.json`; các entry được stage để đưa vào workspace gồm `AGENTS.md`, `.agents`, `scripts`, `.codex`. `plugin_dir=None`: thành phần middleware ở đây dùng lifecycle hook, không phải plugin TypeScript OpenCode. [Codex surface và materialise][cx]

### 4.3. Hai chế độ recursion và việc “tự tối ưu”

- **Parallel:** bắt đầu với `k` lần chạy base; đề xuất/probe `k` candidate general và `k` candidate domain-specific; tạo `k` composition độc lập từ bằng chứng chung.
- **Sequential:** cũng có `k` reference run, nhưng thực hiện `k` bước liên tiếp, truyền harness đã cải tiến và lịch sử bằng chứng sang bước sau.
- Sau adoption, library theo domain lưu harness/bài học; task trong cùng domain chạy theo thứ tự và chỉ đọc entry trước đó, các domain có thể chạy đồng thời. Library tách theo benchmark, executor, mode, budget và seed. [Experiment guide][experiments] · [Code recursion][recursion]

**Giới hạn quan trọng:** “được chọn” không đồng nghĩa “đã chứng minh tốt hơn baseline”. `selection_pool()` chỉ đưa các final của mode vào pool và chủ động loại base; `k=1` dùng `trivial_selection()` để giao final duy nhất, không mở phiên selector. Vì thế không nên diễn giải vòng tự tối ưu thành một cổng bắt buộc từ chối mọi harness làm chất lượng giảm. [Code selection][selection]

## 5. Requirements và dependency

| Phạm vi | Yêu cầu chính thức |
| --- | --- |
| Nền tảng benchmark | Linux, khuyến nghị Python 3.12; package chấp nhận `>=3.12,<3.14`, tức 3.12/3.13. [Setup][setup] · [pyproject][packaging] |
| Cài package từ nguồn | `uv`, virtual environment; ví dụ README cài editable với extra `render`. [README: Install][readme] |
| Benchmark dùng model | Node.js 20+, Google Cloud CLI, quyền truy cập model và credential phù hợp; setup cài Bun đã pin dưới `dependencies/`. [Setup][setup] |
| LAB | Pandoc và Poppler. [Setup][setup] |
| WorkBuddy-Bench | Docker Engine và quyền chạy `docker info`. [Setup][setup] |
| Extra `render` | `openpyxl>=3.1,<4`, `python-pptx>=1,<2`. [pyproject][packaging] |
| Extra `bridge` | `litellm[proxy]==1.95.0`, `fastapi==0.139.2`, `google-auth==2.56.3`. [pyproject][packaging] |

Core package khai báo `dependencies=[]`, **không có nghĩa toàn hệ thống không cần dependency**: setup clone upstream, áp patch, dựng môi trường benchmark và tải task data; mỗi benchmark có `.venv` riêng, runner tự chọn interpreter. [pyproject][packaging] · [Setup: benchmark installation][setup]

Config ghim revision của JobBench, WorkBuddy-Bench, Harvey LAB và OpenCode; Codex CLI pin `0.144.6`, cấu hình WorkBuddy dùng OpenCode harness `1.14.18`. JobBench dataset được resolve tại thời điểm tải, không pin sẵn trong source; setup ghi revision tải được vào provenance để báo cáo khi tái lập. [Config][config] · [Reproducibility][experiments]

Setup cần truy cập GitHub, npm registry, Hugging Face/CDN, Docker registry và có thể `astral.sh` để tải CPython nếu thiếu. Không nên hiểu bước setup là chỉ thêm một package nhẹ vào DSH. [Setup: Network access during setup][setup]

## 6. Model/provider và credential

| Cấu hình | Ý nghĩa được nguồn xác nhận |
| --- | --- |
| `HARNESS2_SOLVER_MODEL` | Model executor theo cú pháp OpenCode `provider/model`; code không đặt model ID mặc định cụ thể. [Setup][setup] · [Config][config] |
| `HARNESS2_IMPROVER_MODEL` | Model sửa harness, cùng cú pháp; mặc định bằng solver nếu không khai báo. [Setup][setup] · [Config][config] |
| `HARNESS2_JUDGE_MODEL` | ID judge để chấm benchmark, adapter bổ sung prefix phù hợp; không phải nhất thiết cùng model với solver. [Setup][setup] · [Config][config] |
| Vertex AI | Tài liệu cấu hình Gemini executor/judge và improver Vertex Claude hoặc Gemini; cần project, quyền model và Application Default Credentials. `GOOGLE_CLOUD_LOCATION` mặc định `global`; shell override `.env`. [Setup][setup] · [Config][config] |
| Codex executor | Nhận Responses API endpoint qua `HARNESS2_CODEX_BASE_URL`, `HARNESS2_CODEX_API_KEY`, `HARNESS2_CODEX_MODEL`; có bridge LiteLLM cục bộ để đưa Gemini Vertex ra giao diện đó. Dùng Codex executor không đồng nghĩa bắt buộc dùng model OpenAI. [Setup: Codex executor][setup] |
| Provider khác | LAB cho phép direct provider của judge upstream khi có credential. Một Responses endpoint khác có thể cấu hình cho Codex, nhưng nguồn không chứng minh mọi provider/model hoặc bridge DSH hiện tại đều tương thích. [Setup][setup] |

Authentication được tài liệu liệt kê: `gcloud auth application-default login`, attached service account, `--no-browser`, service-account key qua `GOOGLE_APPLICATION_CREDENTIALS`, hoặc impersonation. Với cấu hình Vertex được hướng dẫn, `gcloud` vẫn phải có trên PATH vì check gọi `gcloud auth application-default print-access-token`. [Setup: Authentication alternatives][setup]

**Lỗi/thiếu sót tài liệu đã xác nhận ở commit khảo sát:** README và SETUP hướng dẫn `cp .env.example .env`, nhưng recursive tree không có `.env.example`, và truy vấn Contents API của đúng commit trả **HTTP 404 Not Found**. Do đó không thể trích template model ID mặc định như thể file đó tồn tại; các biến ở trên được đối chiếu trực tiếp với code. Không tự tạo `.env` hay suy đoán model ID trong phiên này. [README][readme] · [Setup][setup] · [Cây nguồn][tree] · [API kiểm tra template][env-api] · [Config thực tế][config]

## 7. Cách chạy theo tài liệu — chỉ để tham khảo, chưa thực thi

Các lệnh bên dưới là luồng nguồn chính thức mô tả, **không phải khuyến nghị chạy ngay trên máy DSH và không phải nhật ký đã chạy**. Cần xử lý template bị thiếu, credential, ngân sách và isolation trước. [README][readme] · [Setup][setup]

### 7.1. Demo không cần model credential

Từ repository root, README hướng dẫn:

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -e '.[render]'
harness2-demo --output runs/demo --k 2
```

Demo dùng deterministic editor và chạy Python thật ở cả hai mode, không cần model credential. “Không cần model credential” không có nghĩa không thực thi code; đây vẫn là thao tác cần được cấp quyền riêng. [README: Install][readme]

### 7.2. Ví dụ một task LAB dùng model

Sau khi chuẩn bị môi trường/model/credential như SETUP, luồng README là:

```bash
harness2-setup lab
harness2-check --bench lab
harness2 --bench lab --k 1 --mode parallel \
  --only-domains antitrust-competition --max-tasks 1
harness2-judge --bench lab --k 1 --mode parallel
harness2-report --bench lab --k 1 --mode parallel
```

- `harness2-setup <bench> --dry-run` preview bước setup không thay đổi môi trường; `harness2 --dry-run` preview task selection không gọi model. Chỉ đọc mô tả các chế độ này, chưa chạy trong khảo sát. [Setup][setup] · [CLI code][cli]
- `harness2-check` kiểm tra dependency/credential/config không gọi model, **không xác minh model thật sự khả dụng**; lỗi quyền/model có thể chỉ xuất hiện ở lần gọi đầu. [Setup: Installation checks][setup]
- Đổi `--mode sequential` để chạy chiều sâu; dùng `--substrate cx` nhất quán khi chọn Codex. WorkBuddy cần `--subset office`, `web` hoặc `code`. [README][readme] · [Experiment guide][experiments]
- Judge/report phải giữ cùng benchmark, executor, subset, budget, mode, seed. Lặp cùng command để resume; đổi model/task selection thì dùng output root mới bằng `HARNESS2_RUNS_DIR`. [README][readme] · [Experiment guide][experiments]
- `--max-tasks 1` là **mỗi domain một task**, không phải tổng toàn bộ run; phải thêm `--only-domains` nếu muốn giới hạn đúng một domain. [Experiment guide: Task selection and cost][experiments]

## 8. Sandbox, security và độ tin cậy của evaluation

### 8.1. Điều nguồn thừa nhận rõ

1. **Network unrestricted:** bản phát hành không hạn chế mạng executor. Tác giả ghi nhận một rollout Codex JobBench đã tự tải rubric của task mà không được yêu cầu. Đây là rủi ro contamination: kết quả có thể phản ánh việc tìm đáp án/tiêu chí chấm thay vì năng lực mong muốn. [Experiment guide: Web access][experiments-web]
2. **Codex sandbox/approval bị bypass:** README/SETUP nói sandbox disabled; reference argv trong substrate có `--dangerously-bypass-approvals-and-sandbox` và `--dangerously-bypass-hook-trust`. Code cũng lưu ý launcher benchmark xây argv riêng; do đó không dùng reference helper như chứng cứ duy nhất cho mọi đường thực thi, nhưng tài liệu phát hành đã xác nhận chính sách sandbox này. [README][readme-web] · [SETUP][setup] · [Code][cx]
3. **Bridge mở rộng mặt mạng ở WorkBuddy:** tài liệu yêu cầu `harness2-bridge --host 0.0.0.0` để container truy cập, đồng thời cảnh báo lắng nghe trên mọi interface và yêu cầu hạn chế client. Không nên mở như dịch vụ công khai. [Setup: Codex executor][setup]
4. **Cần chặn mạng ngoài tool:** sau setup, tác giả khuyên chặn các host benchmark như Hugging Face, GitHub/raw GitHub bằng egress firewall/DNS policy trên executor host; setup lại cần các host đó để tải dependency. Đây là biện pháp vận hành cần thiết lập riêng, không phải mặc định an toàn sẵn có. [Experiment guide: Web access][experiments-web]

### 8.2. Kiểm tra cấu trúc không phải security sandbox

Code có giới hạn editable path, từ chối đường dẫn tuyệt đối/`..`, kiểm tra skill trigger/frontmatter, compile Python để bắt syntax error và kiểm tra schema command hook. Recursion retry proposal invalid một lần rồi fallback. Những kiểm tra này giúp harness hợp lệ về cấu trúc; **không chứng minh script/plugin/hook không có hành vi nguy hiểm**. Ví dụ compile Python chỉ kiểm tra cú pháp, không kiểm soát quyền truy cập dữ liệu hay mạng khi code chạy. [Tree validation][validation] · [Recursion validation/retry][recursion]

OpenCode reference environment dựng `OPENCODE_PERMISSION` cho `external_directory`, deny mặc định và allow workspace/extra roots; đây là rào permission ở mức framework cho đường dẫn ngoài, không phải bằng chứng có OS sandbox hay cấm mạng. Tài liệu vẫn tuyên bố network unrestricted. [OpenCode `run_env`][oc] · [Network policy][experiments-web]

**Khuyến nghị cho thí nghiệm sau này:** VM/máy riêng không chứa credential DSH hoặc source nhạy cảm; giới hạn mạng và quyền cloud tối thiểu; không mount home thật vào môi trường agent; duyệt diff harness/script/hook trước tái sử dụng; theo dõi billing và không coi Docker của WorkBuddy là chứng nhận isolation cho toàn framework. Đây là phân tích rủi ro của báo cáo, chưa được triển khai hay kiểm chứng ở máy hiện tại.

## 9. Chi phí: nguồn cho phép kết luận gì?

Không tìm thấy bảng giá cố định hay tổng USD/run trong README, SETUP, EXPERIMENTS và code accounting đã đọc. Tài liệu chỉ cảnh báo benchmark dùng model phát sinh phí API; không nên tự gán một mức tiền hoặc nói miễn phí chỉ vì source có license mở. [README][readme] · [Task selection and cost][experiments] · [Ledger][ledger]

Accounting chính thức cho **một task, một mode, budget `k`**:

| Khoản | Số lượng cơ sở |
| --- | --- |
| Executor rollout | `R = 4k`: `k` base + `2k` candidate + `k` final |
| Improvement stage | `P = 3k`: `k` invariant + `k` domain + `k` composition |
| Ngoài ledger này | Selection, reflection, retry invocation; grading chạy qua judge riêng |

Một rollout hoặc improvement stage có thể bao gồm nhiều model/tool turn, nên **không được đổi `4k + 3k` thành đúng số request API hoặc số USD**. `k=1` vẫn có bốn executor rollout và ba improvement stage, chưa tính reflection/judge và retry; selector được bỏ qua khi final chỉ có một. [Ledger identity][ledger] · [Recursion implementation][recursion] · [Selection implementation][selection] · [Judge CLI trong quy trình][readme]

Phần tiền thực trả còn phụ thuộc model/provider, token input/output, cache, task dài/ngắn, retry và hạ tầng cloud/container/lưu trữ. Đây là các yếu tố cần tính khi lập ngân sách, không phải số đo trong phiên này. Để giảm rủi ro, nguồn khuyên chọn ít task, xem model pricing trước và preview selection; toàn LAB có 1.143 task nên không chạy toàn bộ mặc định để “thử”. [Experiment guide: Task selection and cost][experiments]

## 10. Có phải plugin DSH không? Nên làm gì tiếp?

**Không có bằng chứng đây là plugin DSH ở commit khảo sát; cấu trúc phát hành cho thấy đây là ứng dụng Python độc lập.** `pyproject.toml` tạo executable CLI Python; cây nguồn không có `package.json`/manifest bundle DSH; hai substrate được phát hành là OpenCode và Codex. Từ “plugins” trong tám thành phần là plugin OpenCode/hook Codex mà harness editor có thể tạo, không phải tuyên bố package Harness² là plugin DSH. [Packaging][packaging] · [Cây nguồn][tree] · [OpenCode][oc] · [Codex][cx]

Quyết định phù hợp lúc này:

- **Không cài vào profile DSH, không đổi provider/model hay guardrails DSH hiện tại.** Chưa có quyền cài và chưa có bằng chứng adapter tương thích.
- Có thể học phương pháp Propose–Probe–Compose như ý tưởng thiết kế evaluation: so sánh baseline/candidate bằng bài test của chính mình, giữ cổng review người dùng và sandbox hiện tại. Đây là định hướng ứng dụng khái niệm, **không phải tích hợp đã có hoặc đã được thử**.
- Nếu người dùng sau này muốn thí nghiệm, cần xin quyền riêng cho môi trường tách biệt, dependency, credential, giới hạn chi phí và chính sách mạng; xử lý khoảng trống `.env.example` trước. Chỉ cân nhắc tích hợp DSH sau khi có adapter và tiêu chí nghiệm thu rõ ràng.

Dự án dùng Apache-2.0 cho Harness²; third-party code/benchmark/dataset giữ license upstream. README ghi rõ **không phải sản phẩm được Google hỗ trợ chính thức** và không đủ điều kiện cho Google OSS Vulnerability Rewards Program. Không nên đánh đồng repository trong tổ chức Google Research với cam kết hỗ trợ sản phẩm. [README: License/Disclaimer][readme] · [License][license]

## 11. Hạn chế và bằng chứng kiểm chứng

- Đã đọc chính thức bằng `gh` tại SHA ghim; không dựa vào tên repo hoặc mô tả từ mạng xã hội.
- Đã xác nhận API `.env.example` trả HTTP 404; đây là lỗi thiếu template tại snapshot, không khẳng định mọi phiên bản tương lai đều thiếu.
- Chưa cài hoặc chạy demo, setup, benchmark, model call, bridge hay test upstream: **chưa verify runtime**, hiệu năng, chi phí thực tế, hoặc khả năng chạy trên máy này.
- Không khảo sát cấu hình DSH riêng, không kiểm tra endpoint/model hiện có của người dùng; **chưa verify tương thích DSH**.
- Chưa kiểm toán toàn bộ third-party patch, container image, dependency supply chain hoặc mọi launcher. Các nhận định bảo mật dựa trên cảnh báo chính thức và code tiêu biểu đã dẫn, không phải kết luận “không còn rủi ro khác”.
- Markdown được kiểm tra riêng sau khi ghi báo cáo; kết quả kiểm tra sẽ được báo trong phần bàn giao, không coi đó là kiểm chứng chạy Harness².

## Nguồn chính thức tại commit khảo sát

Các nhãn nguồn dưới đây đều ghim SHA, trừ link trang repository dùng để nhận diện dự án.

[commit]: https://github.com/google-research/harness2/commit/1cfe254e8d25b15f37048c3730134686abe60335
[tree]: https://api.github.com/repos/google-research/harness2/git/trees/1cfe254e8d25b15f37048c3730134686abe60335?recursive=1
[readme]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/README.md
[readme-web]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/README.md#web-access
[setup]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/SETUP.md
[experiments]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md
[experiments-web]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md#web-access
[packaging]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/pyproject.toml
[config]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/config.py
[oc]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/opencode.py
[cx]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/codex.py
[recursion]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py
[selection]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py
[validation]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/tree.py
[ledger]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/ledger.py
[cli]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/cli/run_sweep.py
[env-api]: https://api.github.com/repos/google-research/harness2/contents/.env.example?ref=1cfe254e8d25b15f37048c3730134686abe60335
[license]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/LICENSE
