export interface Env {
  RESEND_API_KEY: string;
  SITES_CONFIG?: string; // JSON string mapping site keys to SiteConfig
  RECAPTCHA_SECRET_KEY?: string;
}

export interface SiteConfig {
  fromEmail: string;
  toEmail: string;
  defaultSubject?: string;
  allowedOrigins: string[];
}

function parseSitesConfig(config?: string | Record<string, SiteConfig>): Record<string, SiteConfig> {
  if (!config) return {};
  if (typeof config === 'object') return config;
  try {
    return JSON.parse(config);
  } catch (err) {
    console.error('Failed to parse SITES_CONFIG JSON:', err);
    return {};
  }
}

function getCorsHeaders(origin: string, allowedOrigins: string[]) {
  const isAllowed = allowedOrigins.includes(origin) || origin.startsWith('http://localhost:');

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : (allowedOrigins[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';
    const sites = parseSitesConfig(env.SITES_CONFIG);

    // Collect all allowed origins across all configured sites for generic preflight
    const allAllowedOrigins = Object.values(sites).flatMap((s) => s.allowedOrigins);

    // 1. Handle CORS Preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(origin, allAllowedOrigins)
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...getCorsHeaders(origin, allAllowedOrigins), 'Content-Type': 'application/json' }
      });
    }

    try {
      const data = await request.json() as Record<string, any>;

      // 2. Honeypot spam defense (silent drop if bot populated hidden input)
      if (data._hp && String(data._hp).trim() !== '') {
        return new Response(JSON.stringify({ success: true, message: 'Message sent' }), {
          headers: { ...getCorsHeaders(origin, allAllowedOrigins), 'Content-Type': 'application/json' }
        });
      }

      // 3. Validate authorized site key from server-side config
      const siteKey = String(data._site || '').trim();
      const site = sites[siteKey];

      if (!site) {
        return new Response(JSON.stringify({ error: 'Unauthorized or unregistered site identifier' }), {
          status: 403,
          headers: { ...getCorsHeaders(origin, allAllowedOrigins), 'Content-Type': 'application/json' }
        });
      }

      const siteCorsHeaders = getCorsHeaders(origin, site.allowedOrigins);

      // Verify origin against this specific site's allowed domains
      const isOriginAllowed = site.allowedOrigins.includes(origin) || origin.startsWith('http://localhost:');
      if (origin && !isOriginAllowed) {
        return new Response(JSON.stringify({ error: 'Request origin not permitted for this site' }), {
          status: 403,
          headers: { ...siteCorsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. Optional Google reCAPTCHA Verification
      if (data._recaptchaToken && env.RECAPTCHA_SECRET_KEY) {
        const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${encodeURIComponent(env.RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(data._recaptchaToken)}`
        });
        const verifyData = await verifyRes.json() as { success: boolean };
        if (!verifyData.success) {
          return new Response(JSON.stringify({ error: 'CAPTCHA verification failed' }), {
            status: 400,
            headers: { ...siteCorsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      // 5. Build dynamic HTML table from form submission data
      const subject = data._subject || site.defaultSubject || 'New Website Inquiry';
      const customerEmail = data.email || data.Email || data.email_address || undefined;

      const rows = Object.entries(data)
        .filter(([key]) => !key.startsWith('_')) // Exclude meta fields
        .map(([key, val]) => `
          <tr>
            <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: 600; color: #1e293b; background: #f8fafc; width: 35%;">
              ${key}
            </td>
            <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #334155;">
              ${String(val).replace(/\n/g, '<br>')}
            </td>
          </tr>
        `).join('');

      const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #18254c; margin-top: 0; border-bottom: 2px solid #d57c48; padding-bottom: 10px; font-size: 20px;">
            Inquiry Details
          </h2>
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            ${rows}
          </table>
          <p style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center;">
            Dispatched securely via <strong>contact-api</strong> &bull; Cloudflare Worker &amp; Resend
          </p>
        </div>
      `;

      // 6. Deliver email via Resend REST API
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: site.fromEmail,
          to: [site.toEmail],
          subject: subject,
          html: htmlContent,
          reply_to: customerEmail
        })
      });

      if (!resendResponse.ok) {
        const errorText = await resendResponse.text();
        console.error('Resend API Error:', errorText);
        return new Response(JSON.stringify({ error: 'Failed to deliver email' }), {
          status: 500,
          headers: { ...siteCorsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Inquiry sent successfully' }), {
        status: 200,
        headers: { ...siteCorsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err: any) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
        status: 500,
        headers: { ...getCorsHeaders(origin, allAllowedOrigins), 'Content-Type': 'application/json' }
      });
    }
  }
};
