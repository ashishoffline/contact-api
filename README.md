# contact-api

> Serverless multi-tenant contact form & transactional email API powered by [Cloudflare Workers](https://workers.cloudflare.com/) and [Resend](https://resend.com/).

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ashishoffline/contact-api)

A single, lightweight, high-performance edge function that handles contact inquiries, lead submissions, and notifications for multiple static websites (portfolios, client landing pages, commercial stores) with zero cold starts, zero hardcoded emails, and built-in anti-spam defenses.

---

## Key Features

- ⚡ **Zero Cold Starts (< 5ms)**: Runs on Cloudflare V8 Isolates with instant global execution.
- 🔒 **Zero Hardcoded Emails**: Client emails, target inboxes, and allowed origins are fully decoupled into Cloudflare environment variables (`SITES_CONFIG`). The repository contains 0 sensitive data.
- 🛡️ **Dual Anti-Spam Defense**:
  - **Honeypot Trap**: Silently drops automated bots with 200 OK.
  - **Google reCAPTCHA v2/v3**: Optional server-side token verification.
- 🌐 **Strict Origin & Site Whitelisting**: Rejects unknown sites and enforces CORS matching per domain.
- ✉️ **One-Click Reply-To**: Replies in your email client automatically route to the customer's email.
- 💰 **100% Free**: Operates within Cloudflare's 100,000 requests/day and Resend's 3,000 emails/month free tiers.

---

## Architecture & Data Flow

```
[ Client Website ] ──(POST JSON: _site, fields)──▶ [ Cloudflare Worker ]
                                                            │
                                                  1. Match _site in SITES_CONFIG
                                                  2. Validate Origin & Honeypot
                                                  3. Optional reCAPTCHA Verification
                                                  4. Format Dynamic HTML Table
                                                            │
                                                            ▼
                                                  [ Resend REST API ] ──▶ [ Target Client Inbox ]
```

---

## Configuration

In your Cloudflare Dashboard (under **Settings > Variables and Secrets**) or local `.dev.vars`, define:

### 1. Secrets (Encrypted)
- `RESEND_API_KEY`: Your Resend API key (`re_...`)
- `RECAPTCHA_SECRET_KEY`: *(Optional)* Google reCAPTCHA secret key

### 2. Environment Variables
- `SITES_CONFIG`: A JSON string defining authorized sites, senders, inboxes, and allowed domains:

```json
{
  "site-one": {
    "fromEmail": "Website Notifications <notifications@send.example.com>",
    "toEmail": "inbox@example.com",
    "defaultSubject": "New Website Inquiry",
    "allowedOrigins": [
      "https://example.com",
      "https://www.example.com",
      "http://localhost:5173"
    ]
  },
  "site-two": {
    "fromEmail": "Portfolio Contact <notifications@send.portfolio.dev>",
    "toEmail": "contact@portfolio.dev",
    "defaultSubject": "New Contact Message",
    "allowedOrigins": [
      "https://portfolio.dev",
      "http://localhost:3000"
    ]
  }
}
```

---

## API Contract & Client Usage

Submit inquiries as standard JSON using `POST /` with `Content-Type: application/json`:

### Request Schema (`ContactSubmission`)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `site` | `string` | **Yes** | Authorized site identifier matching a key in `SITES_CONFIG`. |
| `name` | `string` | **Yes** | Sender / customer name. |
| `email` | `string` | **Yes** | Sender email address (validated and bound directly to `reply_to`). |
| `message` | `string` | **Yes** | Inquiry message or requirements. |
| `phone` | `string` | No | Customer phone or mobile number. |
| `product` | `string` | No | Product of interest (for catalog quotes). |
| `inquiryChannel` | `string` | No | Source channel (e.g. `'Website Form'`, `'WhatsApp'`). |
| `subject` | `string` | No | Custom dynamic email subject line. |
| `hp` | `string` | No | Honeypot trap field (must be empty for real users). |
| `recaptchaToken` | `string` | No | Google reCAPTCHA v3 client token. |

Any undeclared or unrecognized fields in the JSON payload are discarded.

### Example Client Request

```javascript
await fetch('https://contact-api.<your-subdomain>.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    site: 'site-one',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1 555 123 4567',
    message: 'Hello, I would like to request a quotation.',
    product: 'Signage Board',
    inquiryChannel: 'Website Form',
    hp: ''
  })
});
```

Empty, null, or undefined optional fields are automatically omitted from the email body table. All values are automatically HTML-escaped for security.

---

## Local Development

```bash
git clone https://github.com/ashishoffline/contact-api.git
cd contact-api
pnpm install

# Setup local variables
cp .dev.vars.example .dev.vars

# Run local development worker
pnpm run dev
```

---

## License

[MIT](LICENSE) &copy; [Ashish Jha](https://ashishjha.dev)
