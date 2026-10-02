export interface Env {
  RESEND_API_KEY: string;
  SITES_CONFIG?: string; // JSON string mapping site keys to SiteConfig
  TURNSTILE_SECRET_KEY?: string;
}

export interface SiteConfig {
  fromEmail: string;
  toEmail: string;
  defaultSubject?: string;
  allowedOrigins: string[];
}

/**
 * Strict API Contract for incoming contact submissions.
 */
export interface ContactSubmission {
  // Routing & Security
  site: string;              // Authorized site identifier in SITES_CONFIG
  subject?: string;          // Optional custom dynamic email subject
  hp?: string;               // Optional honeypot trap field (must be empty)
  turnstileToken?: string;   // Optional Cloudflare Turnstile token

  // Mandatory Core User Info
  name: string;              // Customer / Sender Name
  email: string;             // Customer / Sender Email (used for reply_to)
  message: string;           // Inquiry message / requirements

  // Optional Form Fields
  phone?: string;            // Contact phone number
  product?: string;          // Product of interest (for catalog quotes)
  inquiryChannel?: string;   // Source channel ('Website Form', 'WhatsApp')
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationSuccess {
  valid: true;
  site: SiteConfig;
  corsHeaders: Record<string, string>;
  data: ContactSubmission;
}

export interface ValidationFailure {
  valid: false;
  status: number;
  title: string;
  detail: string;
  corsHeaders: Record<string, string>;
  errors?: ValidationError[];
}

export type ValidationOutcome = ValidationSuccess | ValidationFailure;

interface FormFieldDefinition {
  key: keyof ContactSubmission;
  label: string;
}

const DISPLAY_FIELDS: FormFieldDefinition[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'product', label: 'Product' },
  { key: 'inquiryChannel', label: 'Inquiry Channel' },
  { key: 'message', label: 'Message' }
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function getCorsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  const isAllowed = allowedOrigins.includes(origin) || origin.startsWith('http://localhost:');

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : (allowedOrigins[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Generates an RFC 9457 / RFC 7807 Problem Details response.
 */
function problemDetails(
  title: string,
  status: number,
  detail: string,
  corsHeaders: Record<string, string>,
  errors?: ValidationError[]
): Response {
  const body: Record<string, any> = {
    type: 'about:blank',
    title,
    status,
    detail
  };

  if (errors && errors.length > 0) {
    body.errors = errors;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/problem+json'
    }
  });
}

/**
 * Validates the submission payload, authorization, and collects all field-level validation errors.
 */
function validateSubmission(
  data: Record<string, any>,
  sites: Record<string, SiteConfig>,
  origin: string,
  allAllowedOrigins: string[]
): ValidationOutcome {
  const genericCors = getCorsHeaders(origin, allAllowedOrigins);

  // 1. Site Identifier
  const siteKey = typeof data.site === 'string' ? data.site.trim() : '';
  if (!siteKey) {
    return {
      valid: false,
      status: 400,
      title: 'Bad Request',
      detail: 'Missing required field: site.',
      corsHeaders: genericCors,
      errors: [{ field: 'site', message: 'Site identifier is required.' }]
    };
  }

  const site = sites[siteKey];
  if (!site) {
    return {
      valid: false,
      status: 403,
      title: 'Forbidden',
      detail: 'Unauthorized or unregistered site identifier.',
      corsHeaders: genericCors
    };
  }

  const siteCors = getCorsHeaders(origin, site.allowedOrigins);

  // 2. Origin Verification
  const isOriginAllowed = site.allowedOrigins.includes(origin) || origin.startsWith('http://localhost:');
  if (origin && !isOriginAllowed) {
    return {
      valid: false,
      status: 403,
      title: 'Forbidden',
      detail: 'Request origin is not authorized for this site.',
      corsHeaders: siteCors
    };
  }

  // 3. Collect all user-field validation errors
  const errors: ValidationError[] = [];

  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (name.length > 100) {
    errors.push({ field: 'name', message: 'Name must not exceed 100 characters.' });
  }

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) {
    errors.push({ field: 'email', message: 'Email address is required.' });
  } else if (!emailRegex.test(email)) {
    errors.push({ field: 'email', message: 'Email address format is invalid.' });
  } else if (email.length > 254) {
    errors.push({ field: 'email', message: 'Email address must not exceed 254 characters.' });
  }

  const message = typeof data.message === 'string' ? data.message.trim() : '';
  if (!message) {
    errors.push({ field: 'message', message: 'Message is required.' });
  } else if (message.length > 5000) {
    errors.push({ field: 'message', message: 'Message must not exceed 5,000 characters.' });
  }

  if (data.phone !== undefined && data.phone !== null) {
    if (typeof data.phone !== 'string' && typeof data.phone !== 'number') {
      errors.push({ field: 'phone', message: 'Phone must be a valid string or number.' });
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      status: 400,
      title: 'Validation Failed',
      detail: 'One or more fields in the submission are invalid.',
      corsHeaders: siteCors,
      errors
    };
  }

  const cleanName = name.replace(/[\r\n<>]/g, '').trim();

  const sanitizedSubmission: ContactSubmission = {
    site: siteKey,
    name: cleanName,
    email,
    message,
    phone: data.phone !== undefined && data.phone !== null ? String(data.phone).trim() : undefined,
    product: typeof data.product === 'string' && data.product.trim() !== '' ? data.product.trim() : undefined,
    inquiryChannel: typeof data.inquiryChannel === 'string' && data.inquiryChannel.trim() !== '' ? data.inquiryChannel.trim() : undefined,
    subject: typeof data.subject === 'string' && data.subject.trim() !== '' ? data.subject.trim() : undefined,
    hp: typeof data.hp === 'string' ? data.hp.trim() : undefined,
    turnstileToken: typeof data.turnstileToken === 'string' && data.turnstileToken.trim() !== ''
      ? data.turnstileToken.trim()
      : typeof data['cf-turnstile-response'] === 'string' && data['cf-turnstile-response'].trim() !== ''
        ? data['cf-turnstile-response'].trim()
        : undefined,
  };

  return {
    valid: true,
    site,
    corsHeaders: siteCors,
    data: sanitizedSubmission
  };
}

/**
 * Builds the HTML table representation of the submitted inquiry.
 */
function buildEmailHtml(data: ContactSubmission): string {
  const rows = DISPLAY_FIELDS
    .map(({ key, label }) => {
      const rawVal = data[key];
      if (rawVal === undefined || rawVal === null) return null;
      const val = String(rawVal).trim();
      if (val === '') return null;

      return `
        <tr>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-weight: 600; color: #1e293b; background: #f8fafc; width: 35%;">
            ${escapeHtml(label)}
          </td>
          <td style="padding: 10px 14px; border: 1px solid #e2e8f0; color: #334155;">
            ${escapeHtml(val).replace(/\n/g, '<br>')}
          </td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join('');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #18254c; margin-top: 0; border-bottom: 2px solid #d57c48; padding-bottom: 10px; font-size: 20px;">
        Inquiry Details
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        ${rows}
      </table>
    </div>
  `;
}

interface TurnstileSiteverifyResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

/**
 * Canonical Cloudflare Turnstile server-side siteverify validation.
 */
async function verifyTurnstile(
  token: string,
  secretKey: string,
  allowedOrigins: string[],
  remoteIp?: string
): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return false;
  }

  const expectedHostnames = new Set(
    allowedOrigins
      .map((origin) => {
        try {
          return new URL(origin).hostname.toLowerCase();
        } catch {
          return origin.toLowerCase().trim();
        }
      })
      .filter(Boolean)
  );

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {})
    });

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: body.toString()
    });

    if (!res.ok) {
      console.error(`Turnstile siteverify HTTP error: ${res.status}`);
      return false;
    }

    const result = await res.json() as TurnstileSiteverifyResponse;
    if (!result.success) {
      console.error('Turnstile verification failed:', result['error-codes']);
      return false;
    }

    // Validate hostname against site's allowed hostnames if available
    if (result.hostname && expectedHostnames.size > 0) {
      const resultHost = result.hostname.toLowerCase();
      if (!expectedHostnames.has(resultHost)) {
        console.error(`Turnstile hostname mismatch: received ${resultHost}, expected one of`, Array.from(expectedHostnames));
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Turnstile siteverify fetch error:', err);
    return false;
  }
}

/**
 * Dispatches the transactional email via Resend REST API.
 */
async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  replyTo: string
): Promise<{ ok: boolean; errorText?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      reply_to: replyTo
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, errorText };
  }
  return { ok: true };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';
    const sites = parseSitesConfig(env.SITES_CONFIG);
    const allAllowedOrigins = Object.values(sites).flatMap((s) => s.allowedOrigins);
    const genericCors = getCorsHeaders(origin, allAllowedOrigins);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: genericCors });
    }

    if (request.method !== 'POST') {
      return problemDetails('Method Not Allowed', 405, 'Only POST requests are supported.', genericCors);
    }

    try {
      const data = await request.json() as Record<string, any>;

      // 2. Silent Honeypot Drop (drops automated bots without notification)
      if (typeof data.hp === 'string' && data.hp.trim() !== '') {
        return new Response(JSON.stringify({ success: true, message: 'Message sent' }), {
          headers: { ...genericCors, 'Content-Type': 'application/json' }
        });
      }

      // 3. Centralized Validation (collects all field errors in RFC 9457 standard)
      const validation = validateSubmission(data, sites, origin, allAllowedOrigins);
      if (!validation.valid) {
        return problemDetails(
          validation.title,
          validation.status,
          validation.detail,
          validation.corsHeaders,
          validation.errors
        );
      }

      const { site, corsHeaders, data: submission } = validation;

      // 4. Anti-Bot Verification (Cloudflare Turnstile)
      const turnstileSecret = env.TURNSTILE_SECRET_KEY;
      if (turnstileSecret) {
        if (!submission.turnstileToken) {
          return problemDetails('Validation Failed', 400, 'Cloudflare Turnstile token is required.', corsHeaders, [
            { field: 'turnstileToken', message: 'Missing bot verification token.' }
          ]);
        }
        const clientIp = request.headers.get('CF-Connecting-IP') ?? undefined;
        const isHuman = await verifyTurnstile(
          submission.turnstileToken,
          turnstileSecret,
          site.allowedOrigins,
          clientIp
        );
        if (!isHuman) {
          return problemDetails('Validation Failed', 400, 'Cloudflare Turnstile verification failed.', corsHeaders, [
            { field: 'turnstileToken', message: 'Turnstile verification failed.' }
          ]);
        }
      }

      // 5. Build HTML & Deliver Email
      const subject = submission.subject || site.defaultSubject || 'New Website Inquiry';
      const replyTo = `${submission.name} <${submission.email}>`;
      const htmlContent = buildEmailHtml(submission);

      const delivery = await sendEmail(
        env.RESEND_API_KEY,
        site.fromEmail,
        site.toEmail,
        subject,
        htmlContent,
        replyTo
      );

      if (!delivery.ok) {
        console.error('Resend API Error:', delivery.errorText);
        return problemDetails('Bad Gateway', 502, 'Failed to dispatch email via upstream provider.', corsHeaders);
      }

      return new Response(JSON.stringify({ success: true, message: 'Inquiry sent successfully' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err: any) {
      console.error('Worker error:', err);
      return problemDetails('Internal Server Error', 500, err.message || 'An unexpected error occurred.', genericCors);
    }
  }
};
