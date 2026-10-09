# 邮件转 Excel 跟进表（网页版）

**打开就能用：https://jwen0001-collab.github.io/msg-to-excel-web/**

把 Outlook 导出的 `.msg` 邮件（包括里面作为附件的邮件）逐封整理成 11 列的跟进表 Excel。
不用安装任何东西，不用懂代码。

## 怎么用

1. 在 Outlook 里选中邮件，**直接拖到桌面**（或：文件 → 另存为 → 类型选 "Outlook 邮件格式 (*.msg)"），得到 `.msg` 文件。
2. 打开上面的网址，把 `.msg` 拖进虚线框（或点虚线框选择，可以一次选多个）。
3. 点 **生成 Excel**，浏览器会自动下载结果，每个 `.msg` 一个 Excel。

## 安全

- 邮件**只在你自己的浏览器里处理**，不会上传到任何服务器；没有数据库，不记录任何东西。
- 不填 AI Key 时，页面加载完之后**完全不联网**。页面设置了安全策略：只运行本站的代码，不加载任何外部脚本。
- 想确认的话：按 `F12` → Network（网络）标签，处理邮件时不会出现任何新的请求。

## AI 总结（可选）

不填时，Summary / Issues description 是**原文摘录**（原语言），不是总结或翻译。

在 "2. AI 总结" 里填 API Key、接口地址、模型后，每封邮件会发送到**你填的这个接口**，生成英文总结：

- 接口需要兼容 OpenAI 的 `POST {接口地址}/chat/completions`。
- Key 只存在这个页面的内存里，**不保存到电脑上**，刷新或关闭页面就清空，不会出现在 Excel 和说明里。
- 人员、紧急、催办日期必须能在邮件原文里找到依据，找不到就留空。
- 某封失败时，该行改用原文摘录，并在说明里写明。
- 如果提示 "AI 接口连不上"：多半是公司网络拦截，或者该接口不允许网页直接调用（CORS）。这时需要请 IT 放行本网址。
- **只在公司允许把邮件内容发给该 AI 接口时使用。**

## 各列规则

| 列 | 规则 |
|---|---|
| Entry date | 生成当天（巴黎时间） |
| Email Subject | 原样保留 |
| Summary | 当前邮件开头约 200 字的原文摘录；纯转发时取被转发的内容 |
| Issues description | 当前邮件 + 引用的历史邮件的原文摘录，约 1000 字；去掉免责声明和引用邮件头 |
| Requestor | 发件人显示名；标题以 FW / Fwd / TR 开头时留空（转发人不等于请求人） |
| Follow up by | 只认明确句式：Please contact X / Merci de contacter X / Suivi par X 等，否则留空 |
| Status | Open |
| Priority | 高重要性标记，或标题 / 当前正文出现 urgent、urgence、ASAP 等时为 Urgent；排除 not urgent / pas urgent，引用历史里的不算 |
| Opening date | 留空 |
| Last remind Date | 当前或引用邮件里有 reminder / relance / petit rappel 等催办措辞时，取最近一封的日期；纯数字日期（日月顺序有歧义）留空 |
| Last update | 留空 |

附件里的 `.eml` 等非 `.msg` 邮件不处理，会写进表格下方的说明里，不会悄悄丢掉。

## 开发

规则移植自 Python 版（`msg_to_excel.py`），同一封邮件两边输出逐格一致。

```
npm install
npm test          # 单元测试
npm run dev       # 本地预览
npm run build     # 生成 dist/
node tools/golden.mjs <邮件.msg> <输出.xlsx> <YYYY-MM-DD>   # 与 Python 版对照用
node tools/e2e.mjs <邮件.msg> <输出目录> [chrome.exe]        # 真实浏览器测试（先 build）
```

不要把真实邮件提交进仓库（`.gitignore` 已排除 `.msg` / `.xlsx`）。
