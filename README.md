# Email to Excel Follow-up Tracker

**Open the app: https://jwen0001-collab.github.io/msg-to-excel-web/**

Convert Outlook `.msg` emails, including embedded `.msg` attachments, into an Excel follow-up tracker. No installation is required. The interface, processing messages and Excel column headings are in English.

## Usage

1. Drag emails from Outlook to your desktop, or use **File → Save As → Outlook Message Format (*.msg)**.
2. Open the app and drop one or more `.msg` files into the upload area.
3. Choose **Multi-file mode** (default: one row per uploaded file; 11 readable files = 11 data rows) or **Nested mode** (recursively expand embedded emails into separate rows; container emails are excluded). Enter your **DeepSeek API key** for English topic summaries and selected original issue excerpts. The API base URL defaults to `https://api.deepseek.com` and the model defaults to **`deepseek-flash`**.
4. To use another model or provider, expand **Advanced: change provider or model** and edit the model and/or API base URL. Use the matching provider's API key. Blank advanced fields fall back to the DeepSeek defaults.
5. Click **Generate batch Excel**. All selected `.msg` files and their embedded emails are combined into **one workbook with one worksheet**, in selection order. A single Excel download link and any processing notes appear below the button. Unreadable files are skipped and reported; other files continue processing. No workbook is downloaded if the batch contains no readable emails.

Leave the key blank for offline conversion, even with the default provider/model filled in. Summary then contains a quoted original excerpt, not a generated summary. Issues description always contains a short original excerpt in double quotes. Empty cells stay blank. Generated summaries use natural business English without AI labels or boilerplate; processing notes remain outside the worksheet.

Both modes combine the entire batch into one workbook. Multi-file mode preserves each uploaded file as one entry, with attached messages as context. Nested mode lists the innermost attached emails; a file without mail attachments contributes its own row. Quoted email history in the body is context rather than separate rows. Emails that are neither attached nor quoted cannot be retrieved from Outlook automatically.

## AI summary and issue description

With an API key, each email is sent to the configured OpenAI-compatible `POST {base URL}/chat/completions` endpoint to generate:

- **Summary:** one concise English sentence describing the main topic and what needs following up. For a bare forward or reminder, use the underlying request.
- **Issues description:** select only 1–2 short contiguous sentences from the original body that express the core problem or request, capped at 320 characters. Exclude openings, closings, signatures and disclaimers. Do not paraphrase or translate. For multilingual emails, retain only one original English or French version, without repeating translations. The exporter encloses the excerpt in double quotes and checks that the selected wording exists in the source.

Names, acronyms and project terms retain their original spelling. People, urgency and reminder dates require supporting evidence in the email. The original Email Subject remains unchanged.

If an AI request fails, the page shows the error (including authentication, balance, endpoint/model, rate-limit or network errors) and asks for confirmation before using any fallback. **Cancel stops the batch without downloading an Excel file.** Confirm allows quoted original excerpts for affected entries for this batch; a separate report identifies them. A returned issue excerpt that cannot be verified against the source also requires approval before a local excerpt is substituted. An unreachable endpoint may indicate a network restriction or a provider that does not permit direct browser requests (CORS).

## Privacy

- Without a key, email parsing and Excel generation run locally in the browser without AI requests.
- With a key, email text is sent to the selected AI endpoint. Use this mode only when sharing that content with the provider is permitted.
- The key is kept in page memory only. It is not stored in browser storage or included in Excel files or reports. Reloading or closing the page clears it.
- There is no application backend or database. The page loads no external scripts.

## Excel columns

| Column | Rule |
|---|---|
| Entry date | Date of conversion in Paris time |
| Email Subject | Original subject, unchanged |
| Summary | AI: one-sentence English topic summary. Offline/fallback: approximately 200 characters of the current message, or underlying content for a bare forward |
| Issues description | Short, quoted original issue/request excerpt; 1–2 sentences, at most 320 characters. Local/offline extraction uses the first substantive sentence, excluding separate greeting and sign-off lines |
| Requestor | Sender's display name; blank for FW/Fwd/TR forwards in offline mode. AI requires evidence of the original requestor |
| Follow up by | Explicitly designated contacts only; otherwise blank |
| Status | Open |
| Priority | Urgent for high importance or explicit urgency in the current subject/body; negated urgency and quoted history alone do not qualify |
| Opening date | Blank |
| Last remind Date | Most recent explicit reminder date; ambiguous numeric dates are left blank in offline mode |
| Last update | Blank |

Unsupported mail attachments such as `.eml` files are reported separately. Embedded `.msg` attachments are processed recursively.

## Development

```sh
npm ci
npm test
npm run dev
npm run build
node tools/golden.mjs <email.msg> <output.xlsx> <YYYY-MM-DD>
node tools/e2e.mjs <email.msg> <output-directory> [chrome.exe]
```

Never commit real emails, API keys or exported workbooks. `.gitignore` excludes `.msg`, `.eml`, `.xlsx` and report files. The rule-based parser preserves the original Python tool's column contract.
