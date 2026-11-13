# Email to Excel Follow-up Tracker

**Open the app: https://jwen0001-collab.github.io/msg-to-excel-web/**

Convert Outlook `.msg` emails, including embedded `.msg` attachments, into an Excel follow-up tracker. No installation is required. The interface, processing messages and Excel column headings are in English.

## Usage

1. Drag emails from Outlook to your desktop, or use **File → Save As → Outlook Message Format (*.msg)**.
2. Open the app and drop one or more `.msg` files into the upload area.
3. Enter your **DeepSeek API key** for English summaries and issue descriptions. The API base URL defaults to `https://api.deepseek.com` and the model defaults to **`deepseek-flash`**. You only need to enter your key each time.
4. To use another model or provider, expand **Advanced: change provider or model** and edit the model and/or API base URL. Use the matching provider's API key. Blank advanced fields fall back to the DeepSeek defaults.
5. Click **Generate Excel**. Each uploaded `.msg` produces one workbook. Download links and any processing notes appear below the button.

Leave the key blank for offline conversion, even with the default provider/model filled in. In offline mode, Summary and Issues description are **original-text excerpts enclosed in double quotes**, not generated summaries or translations. Failed AI requests also fall back to quoted excerpts. Empty cells stay blank. Generated text uses natural business English without AI labels or boilerplate; processing notes remain outside the worksheet.

Select multiple files to process them in one batch. Alternatively, upload a single .msg containing attached emails: nested .msg attachments are read recursively, with one row per leaf email. Container emails are not exported as separate rows. Quoted email history in the body is used as context rather than split into separate rows. Emails that are neither attached nor quoted cannot be retrieved from Outlook automatically.

## AI summary and issue description

With an API key, each email is sent to the configured OpenAI-compatible `POST {base URL}/chat/completions` endpoint to generate:

- **Summary:** one concise English sentence describing the main topic and what needs following up. For a bare forward or reminder, use the underlying request.
- **Issues description:** an English description of the concrete issue or request, relevant email history, impact, explicit actions and stated deadlines. Greetings, signatures and disclaimers are omitted; missing facts must not be invented.

Names, acronyms and project terms retain their original spelling. People, urgency and reminder dates require supporting evidence in the email. The original Email Subject remains unchanged.

If AI fails for an email, its row uses original excerpts and a separate processing report explains the fallback. An unreachable endpoint may indicate a network restriction or a provider that does not permit direct browser requests (CORS).

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
| Issues description | AI: concrete issue, context, actions and stated deadlines in English. Offline/fallback: approximately 1,000 characters of current and quoted content, excluding disclaimers and quoted headers |
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
