# Email to Excel Follow-up Tracker

**Open the app: https://jwen0001-collab.github.io/msg-to-excel-web/**

For AI access without the provider's browser CORS restrictions, deploy the full app to Vercel and use the URL Vercel provides. GitHub Pages is a static-only build and cannot run the relay.

## Deploy to Vercel — no environment variables

1. Push this repository's latest changes to GitHub.
2. Sign in at https://vercel.com/new, import **jwen0001-collab/msg-to-excel-web**, and click **Deploy**. Keep the root directory and project settings at their defaults. Do not add an API key or any environment variables.
3. Open the deployment's URL and enter your API key on the page as usual.

The committed `vercel.json` selects the Vite build and deploys `api/chat.js` as a function. The Vercel build automatically sends requests to `/api/chat` on the same website, avoiding a browser request to the AI provider. The relay forwards each request using the key supplied on the page; it has no stored credentials, database, or application request logging. The supported relay destinations are the official DeepSeek and OpenAI Chat Completions endpoints. Custom model names remain editable.

AI provider usage and hosting remain subject to their respective accounts and plans. An actual model call requires your valid provider key and account balance. Server-side connectivity problems remain possible and are shown as errors; fallback still requires confirmation.

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

With an API key, each email is sent to the configured OpenAI-compatible `POST {base URL}/chat/completions` endpoint, through the same-origin relay in the Vercel build, to generate:

- **Summary:** one concise English sentence describing the main topic and what needs following up. For a bare forward or reminder, use the underlying request.
- **Issues description:** the app numbers short original body excerpts (up to 320 characters), excluding greetings, closings and headers. The model selects the number of the core problem/request; the app inserts the original wording in double quotes. The model does not copy or rewrite the excerpt, avoiding false mismatches caused by its formatting. For multilingual emails, choose one original English or French version without repeating translations. Summary remains a separately generated one-sentence topic.

Names, acronyms and project terms retain their original spelling. People and urgency require supporting evidence in the email. Last remind Date is always read from the corresponding email's sending timestamp, independently of AI or reminder wording. The original Email Subject remains unchanged.

If an AI request fails, the page shows the error (including authentication, balance, endpoint/model, rate-limit or network errors) and asks for confirmation before using any fallback. **Cancel stops the batch without downloading an Excel file.** Confirm allows quoted original excerpts for affected entries for this batch; a separate report identifies them. A returned issue excerpt that cannot be verified against the source also requires approval before a local excerpt is substituted. An unreachable endpoint may indicate a network restriction or a provider that does not permit direct browser requests (CORS).

## Privacy

- Without a key, email parsing and Excel generation run locally in the browser without AI requests.
- With a key, email text is sent to the selected AI endpoint. In the Vercel build, the hosting service relays the text and key. Use this mode only when sharing that content with those services is permitted.
- The key is kept in page memory and used transiently for each relay request. The application does not persist or log keys or email content. Keys are not stored in browser storage or included in Excel files or reports. Reloading or closing the page clears the form.
- The Vercel backend only forwards requests; it has no database. The page loads no external scripts.

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
| Last remind Date | Corresponding email's sending date in Paris time, displayed as DD/MM/YYYY; blank if the sending timestamp is unavailable. Multi-file mode uses each uploaded email's date; nested mode uses each expanded email's date |
| Last update | Blank |

Unsupported mail attachments such as `.eml` files are reported separately. Embedded `.msg` attachments are processed recursively.

## Development

```sh
npm ci
npm test
npm run dev
npm run build
npm run build:vercel  # build for Vercel with the same-origin relay
node tools/golden.mjs <email.msg> <output.xlsx> <YYYY-MM-DD>
node tools/e2e.mjs <email.msg> <output-directory> [chrome.exe]
```

Never commit real emails, API keys or exported workbooks. `.gitignore` excludes `.msg`, `.eml`, `.xlsx` and report files. The rule-based parser preserves the original Python tool's column contract.
