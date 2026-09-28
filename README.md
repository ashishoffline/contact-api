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

## Client Website Usage

From any authorized frontend website, submit inquiries using a standard `fetch()` request:

```javascript
await fetch('https://contact-api.<your-subdomain>.workers.dev', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    _site: 'site-one',        // Must match key in SITES_CONFIG
    _hp: '',                  // Honeypot field (hidden from real users)

    // Any dynamic key-value fields you want in the email notification:
    'Customer Name': 'Jane Doe',
    'Mobile Number': '+1 555 123 4567',
    'Email Address': 'jane@example.com',
    'Message': 'Hello, I would like to request more information.'
  })
});
```

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
