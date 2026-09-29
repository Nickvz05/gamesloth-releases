"use strict";

const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const Stripe = require("stripe");
const { query, withTransaction, initSchema, pool } = require("./db");
const { createLeaderboard } = require("./leaderboard");
const leaderboard = createLeaderboard({ query, withTransaction });

const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://gamesloth-server.onrender.com").replace(/\/$/, "");
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const PRICE_IDS = {
  SLOTH_PLUS: {
    monthly: String(process.env.STRIPE_PRICE_SLOTH_PLUS_MONTHLY || "").trim(),
    annual: String(process.env.STRIPE_PRICE_SLOTH_PLUS_ANNUAL || "").trim()
  },
  SLOTH_PRO: {
    monthly: String(process.env.STRIPE_PRICE_SLOTH_PRO_MONTHLY || process.env.STRIPE_PRICE_CREATOR_MONTHLY || "").trim(),
    annual: String(process.env.STRIPE_PRICE_SLOTH_PRO_ANNUAL || process.env.STRIPE_PRICE_CREATOR_ANNUAL || "").trim()
  }
};

const STRIPE_AUTOMATIC_TAX = String(process.env.STRIPE_AUTOMATIC_TAX || "false").toLowerCase() === "true";
const WEBSITE_BASE_URL = String(process.env.WEBSITE_BASE_URL || "https://gamesloth.app").replace(/\/$/, "");
const ALLOW_SHARED_ADMIN_TOKEN = String(process.env.ALLOW_SHARED_ADMIN_TOKEN || "true").toLowerCase() === "true";
const ADS_ADMIN_TOKEN = String(process.env.ADS_ADMIN_TOKEN || "").trim();
const ADS_TRACKING_SALT = String(process.env.ADS_TRACKING_SALT || STRIPE_WEBHOOK_SECRET || "gamesloth-ads").trim();
const FEEDBACK_ADMIN_TOKEN = String(process.env.FEEDBACK_ADMIN_TOKEN || (ALLOW_SHARED_ADMIN_TOKEN ? ADS_ADMIN_TOKEN : "")).trim();
const ALPHA_ADMIN_TOKEN = String(process.env.ALPHA_ADMIN_TOKEN || (ALLOW_SHARED_ADMIN_TOKEN ? (FEEDBACK_ADMIN_TOKEN || ADS_ADMIN_TOKEN) : "")).trim();
const BACKUP_ADMIN_TOKEN = String(process.env.BACKUP_ADMIN_TOKEN || (ALLOW_SHARED_ADMIN_TOKEN ? (ALPHA_ADMIN_TOKEN || FEEDBACK_ADMIN_TOKEN || ADS_ADMIN_TOKEN) : "")).trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = String(process.env.EMAIL_FROM || "").trim();
const EMAIL_REPLY_TO = String(process.env.EMAIL_REPLY_TO || "").trim();
const EMAIL_VERIFICATION_REQUIRED = String(process.env.EMAIL_VERIFICATION_REQUIRED || "false").toLowerCase() === "true";
const PASSWORD_RESET_TTL_MINUTES = Math.max(10, Math.min(240, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60)));
const EMAIL_VERIFY_TTL_HOURS = Math.max(1, Math.min(168, Number(process.env.EMAIL_VERIFY_TTL_HOURS || 24)));
const CORS_ALLOWED_ORIGINS = new Set(
  String(process.env.CORS_ALLOWED_ORIGINS || `${WEBSITE_BASE_URL},https://www.gamesloth.app,${PUBLIC_BASE_URL}`)
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean)
);
const ALPHA_INVITE_REQUIRED_DEFAULT = String(process.env.ALPHA_INVITE_REQUIRED || "true").trim().toLowerCase() !== "false";
const ALPHA_TESTER_LIMIT_DEFAULT = Math.max(1, Math.min(10000, Number(process.env.ALPHA_TESTER_LIMIT || 20)));
const ALPHA_DOWNLOAD_URL = String(process.env.ALPHA_DOWNLOAD_URL || "https://github.com/Nickvz05/gamesloth-releases/releases/download/v0.33.7/GameSlothSetup-0.33.7.exe").trim();
const RELEASES_REPOSITORY = String(process.env.RELEASES_REPOSITORY || "Nickvz05/gamesloth-releases").trim();
const RELEASE_DOWNLOAD_CACHE_MS = Math.max(60_000, Math.min(60 * 60 * 1000, Number(process.env.RELEASE_DOWNLOAD_CACHE_MS || 5 * 60 * 1000)));
const ALPHA_ADVISORY_LOCK = 73203209;
const FOUNDING_50_ADVISORY_LOCK = 73405029;
const FOUNDING_50_LIMIT = 50;
const FOUNDING_50_REWARD_YEARS = 2;
const FEEDBACK_RATE_WINDOW_MS = 60 * 60 * 1000;
const FEEDBACK_RATE_MAX = Math.max(1, Math.min(100, Number(process.env.FEEDBACK_RATE_MAX || 8)));
const RECOVERY_RATE_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_RATE_MAX = Math.max(2, Math.min(20, Number(process.env.RECOVERY_RATE_MAX || 6)));
const feedbackRateBuckets = new Map();
const recoveryRateBuckets = new Map();

function parseHandleList(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(v => normalizeHandle(v))
      .filter(Boolean)
  );
}

const ALPHA_SLOTH_PLUS_HANDLES = parseHandleList(process.env.ALPHA_SLOTH_PLUS_HANDLES);
const ALPHA_CREATOR_HANDLES = parseHandleList(process.env.ALPHA_CREATOR_HANDLES);
const ALPHA_SLOTH_PRO_HANDLES = parseHandleList(process.env.ALPHA_SLOTH_PRO_HANDLES);

const SERVER_VERSION = "0.34.0";
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const SESSION_TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30));
const CURRENT_ONBOARDING_VERSION = 1;
const UPDATE_BASE_URL = String(process.env.UPDATE_BASE_URL || "").trim().replace(/\/+$/, "");
const ACTIVE_ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ROOM_MEMBERS = Math.max(2, Math.min(16, Number(process.env.MAX_ROOM_MEMBERS || 8)));
const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_MAX = Math.max(3, Number(process.env.AUTH_RATE_MAX || 12));
const REGISTER_RATE_MAX = Math.max(3, Number(process.env.REGISTER_RATE_MAX || 8));
const LOGIN_RATE_MAX = Math.max(3, Number(process.env.LOGIN_RATE_MAX || 12));
const CONTROL_RATE_WINDOW_MS = 10_000;
const CONTROL_RATE_MAX = 80;

const authRateBuckets = new Map();
const registerRateBuckets = new Map();
const loginRateBuckets = new Map();

function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function consumeRateBucket(bucketMap, req, maxAttempts) {
  const key = requestIp(req);
  const now = Date.now();
  const current = bucketMap.get(key);

  if (!current || now - current.startedAt >= AUTH_RATE_WINDOW_MS) {
    bucketMap.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((AUTH_RATE_WINDOW_MS - (now - current.startedAt)) / 1000));
  return { allowed: current.count <= maxAttempts, retryAfterSeconds };
}

function consumeAuthRate(req) {
  return consumeRateBucket(authRateBuckets, req, AUTH_RATE_MAX).allowed;
}

function consumeRegisterRate(req) {
  return consumeRateBucket(registerRateBuckets, req, REGISTER_RATE_MAX);
}

function consumeLoginRate(req) {
  return consumeRateBucket(loginRateBuckets, req, LOGIN_RATE_MAX);
}

function consumeRecoveryRate(req, identity = "") {
  const key = crypto.createHash("sha256")
    .update(`${ADS_TRACKING_SALT}|account-recovery|${requestIp(req)}|${String(identity).toLowerCase()}`)
    .digest("hex");
  const now = Date.now();
  const current = recoveryRateBuckets.get(key);
  if (!current || now - current.startedAt >= RECOVERY_RATE_WINDOW_MS) {
    recoveryRateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RECOVERY_RATE_MAX;
}

function consumeFeedbackRate(req) {
  const key = crypto.createHash("sha256")
    .update(`${ADS_TRACKING_SALT}|feedback-rate|${requestIp(req)}`)
    .digest("hex");
  const now = Date.now();
  const current = feedbackRateBuckets.get(key);

  if (!current || now - current.startedAt >= FEEDBACK_RATE_WINDOW_MS) {
    feedbackRateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= FEEDBACK_RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const bucketMap of [authRateBuckets, registerRateBuckets, loginRateBuckets]) {
    for (const [key, bucket] of bucketMap) {
      if (now - bucket.startedAt > AUTH_RATE_WINDOW_MS * 2) bucketMap.delete(key);
    }
  }
  for (const [key, bucket] of feedbackRateBuckets) {
    if (now - bucket.startedAt > FEEDBACK_RATE_WINDOW_MS * 2) feedbackRateBuckets.delete(key);
  }
  for (const [key, bucket] of recoveryRateBuckets) {
    if (now - bucket.startedAt > RECOVERY_RATE_WINDOW_MS * 2) recoveryRateBuckets.delete(key);
  }
}, AUTH_RATE_WINDOW_MS).unref();

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function createRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeInviteCode(value = "") {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
}

function formatInviteCode(normalized) {
  const clean = normalizeInviteCode(normalized);
  return clean.match(/.{1,4}/g)?.join("-") || clean;
}

function createInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let body = "";
  const bytes = crypto.randomBytes(12);
  for (let index = 0; index < 12; index += 1) body += alphabet[bytes[index] % alphabet.length];
  return `GS-${body.match(/.{1,4}/g).join("-")}`;
}

function hashInviteCode(value) {
  const normalized = normalizeInviteCode(value);
  return crypto.createHash("sha256").update(`gamesloth-alpha-v1|${normalized}`).digest("hex");
}

function inviteCodeHint(value) {
  const normalized = normalizeInviteCode(value);
  if (!normalized) return "—";
  return `${normalized.slice(0, 2)}-••••-••••-${normalized.slice(-4)}`;
}


function accessRequestVisitorKey(req) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256")
    .update(`${ADS_TRACKING_SALT}|alpha-access-request|${requestIp(req)}|${day}`)
    .digest("hex");
}

function cleanAccessRequestText(value, maxLength) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maxLength);
}

function accessInviteMessage(request, code) {
  const name = request.tester_name || "there";
  return `Hey ${name},\n\nYou’re approved for the GameSloth Closed Alpha.\n\nInvite code: ${code}\nDownload: https://gamesloth.app/alpha\n\n1. Open the link and enter the code to unlock the installer.\n2. Use the same code once when creating your GameSloth account.\n3. Send bugs or ideas through https://gamesloth.app/feedback\n\nDo not share the code. It works for one account only.`;
}

async function alphaSettings(client = null) {
  const db = client || { query };
  const now = Date.now();
  const result = await db.query(`SELECT invite_required, tester_limit, founding_50_enabled, updated_at FROM alpha_settings WHERE id = 1 LIMIT 1`);
  if (result.rows[0]) {
    return {
      inviteRequired: !!result.rows[0].invite_required,
      testerLimit: Math.max(1, Math.min(10000, Number(result.rows[0].tester_limit || ALPHA_TESTER_LIMIT_DEFAULT))),
      founding50Enabled: result.rows[0].founding_50_enabled !== false,
      updatedAt: Number(result.rows[0].updated_at || now)
    };
  }
  const inserted = await db.query(
    `INSERT INTO alpha_settings (id, invite_required, tester_limit, founding_50_enabled, updated_at)
     VALUES (1, $1, $2, TRUE, $3)
     ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
     RETURNING invite_required, tester_limit, founding_50_enabled, updated_at`,
    [ALPHA_INVITE_REQUIRED_DEFAULT, ALPHA_TESTER_LIMIT_DEFAULT, now]
  );
  const row = inserted.rows[0];
  return {
    inviteRequired: !!row.invite_required,
    testerLimit: Math.max(1, Math.min(10000, Number(row.tester_limit || ALPHA_TESTER_LIMIT_DEFAULT))),
    founding50Enabled: row.founding_50_enabled !== false,
    updatedAt: Number(row.updated_at || now)
  };
}

async function alphaAccessSummary(client = null, settingsOverride = null) {
  const db = client || { query };
  const settings = settingsOverride || await alphaSettings(client);
  const countResult = await db.query(
    `SELECT alpha_access_status, COUNT(*)::int AS count
       FROM users
      GROUP BY alpha_access_status`
  );
  const counts = Object.fromEntries(countResult.rows.map(row => [String(row.alpha_access_status || "approved"), Number(row.count || 0)]));
  const testerCount = Number(counts.approved || 0);
  const pendingCount = Number(counts.pending || 0);
  const rejectedCount = Number(counts.rejected || 0);
  const spotsRemaining = Math.max(0, settings.testerLimit - testerCount);
  return {
    approvalRequired: settings.inviteRequired,
    inviteRequired: false,
    phase: settings.inviteRequired ? "closed_alpha" : "open_beta",
    testerLimit: settings.testerLimit,
    testerCount,
    pendingCount,
    rejectedCount,
    spotsRemaining,
    acceptingRegistrations: true,
    updatedAt: settings.updatedAt
  };
}

function validateInviteRow(row, now = Date.now()) {
  if (!row) return "That Closed Alpha invite code is not valid.";
  if (!row.active) return "That Closed Alpha invite code has been revoked.";
  if (row.expires_at && Number(row.expires_at) <= now) return "That Closed Alpha invite code has expired.";
  if (Number(row.used_count || 0) >= Number(row.max_uses || 1)) return "That Closed Alpha invite code has already been used.";
  return "";
}

function normalizeHandle(value = "") {
  return String(value).trim().replace(/^@/, "").toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function hashPasswordAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function timingSafeHexEqual(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "hex");
    const right = Buffer.from(String(b || ""), "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    plan: effectivePlan(row),
    billingPlan: normalizedPlan(row.plan),
    subscriptionStatus: row.subscription_status || null,
    onboardingVersion: Number(row.onboarding_version || 0),
    alphaAccessStatus: String(row.alpha_access_status || (row.alpha_access_granted_at ? "approved" : "pending"))
  };
}

function accountUser(row) {
  if (!row) return null;
  return {
    ...publicUser(row),
    email: row.email,
    emailVerified: !!row.email_verified_at,
    founding50: Number(row.founding_50_position || 0) > 0 ? {
      position: Number(row.founding_50_position),
      claimedAt: Number(row.founding_50_claimed_at || 0),
      expiresAt: Number(row.founding_50_expires_at || 0),
      active: activeFounding50Reward(row)
    } : null,
    leaderboardAvailable: leaderboard.enabled,
    leaderboardEnabled: !!row.leaderboard_enabled
  };
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function allowedCorsOrigin(req) {
  const origin = normalizeOrigin(req?.headers?.origin);
  if (!origin) return "";
  if (origin === "null" || origin.startsWith("file://")) return "*";
  return CORS_ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function responseSecurityHeaders(res) {
  const origin = allowedCorsOrigin(res._gameslothRequest);
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-site"
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ads-Admin-Token, X-Feedback-Admin-Token, X-Alpha-Admin-Token, X-Backup-Admin-Token",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    ...responseSecurityHeaders(res)
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request too large."));
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function html(res, status, body) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": payload.length,
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...responseSecurityHeaders(res)
  });
  res.end(payload);
}

let latestWindowsDownloadCache = { url: "", expiresAt: 0 };

async function latestWindowsDownloadUrl() {
  const now = Date.now();
  if (latestWindowsDownloadCache.url && latestWindowsDownloadCache.expiresAt > now) {
    return latestWindowsDownloadCache.url;
  }

  const match = RELEASES_REPOSITORY.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) throw new Error("Invalid RELEASES_REPOSITORY value.");

  const endpoint = `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "GameSloth-Server"
    },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);

  const release = await response.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer =
    assets.find(asset => /^GameSlothSetup-.*\.exe$/i.test(String(asset?.name || ""))) ||
    assets.find(asset => /\.exe$/i.test(String(asset?.name || "")));

  const url = String(installer?.browser_download_url || "").trim();
  if (!url.startsWith("https://github.com/")) throw new Error("Latest Windows installer was not found.");

  latestWindowsDownloadCache = { url, expiresAt: now + RELEASE_DOWNLOAD_CACHE_MS };
  return url;
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end();
}

function normalizedPlan(value) {
  const plan = String(value || "FREE").toUpperCase();
  if (plan === "CREATOR") return "SLOTH_PRO";
  return ["FREE", "SLOTH_PLUS", "SLOTH_PRO"].includes(plan) ? plan : "FREE";
}

function planDisplayName(value) {
  const plan = normalizedPlan(value);
  if (plan === "SLOTH_PRO") return "Sloth Pro";
  if (plan === "SLOTH_PLUS") return "Sloth+";
  return "Free";
}

function maxPovsForPlan(value) {
  const plan = normalizedPlan(value);
  if (plan === "SLOTH_PRO") return 8;
  if (plan === "SLOTH_PLUS") return 4;
  return 2;
}

function planLimits(value) {
  const plan = normalizedPlan(value);
  return {
    maxPovs: maxPovsForPlan(plan),
    monthlyMultiPovSaves: plan === "FREE" ? 5 : null,
    unlimitedMultiPovSaves: plan !== "FREE"
  };
}

function momentSavePeriodKey(timestamp = Date.now()) {
  return new Date(Number(timestamp) || Date.now()).toISOString().slice(0, 7);
}

function cleanMomentSaveKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .slice(0, 160);
}

function cleanMomentSaveSource(value) {
  return String(value || "manual")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 40) || "manual";
}

async function momentSaveQuotaForUser(user, runner = null) {
  const plan = effectivePlan(user);
  const limits = planLimits(plan);
  const periodKey = momentSavePeriodKey();

  if (limits.unlimitedMultiPovSaves) {
    return {
      plan,
      planLabel: planDisplayName(plan),
      periodKey,
      limit: null,
      used: 0,
      remaining: null,
      unlimited: true
    };
  }

  const db = runner || { query };
  const result = await db.query(
    `SELECT COUNT(*)::int AS used
       FROM moment_save_usage
      WHERE user_id = $1 AND period_key = $2`,
    [user.id, periodKey]
  );
  const used = Number(result.rows[0]?.used || 0);
  const limit = Number(limits.monthlyMultiPovSaves || 5);

  return {
    plan,
    planLabel: planDisplayName(plan),
    periodKey,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unlimited: false
  };
}

async function reserveMultiPovMomentSave(user, { momentKey, source = "manual", povCount = 2 } = {}) {
  const cleanKey = cleanMomentSaveKey(momentKey);
  const count = Math.max(0, Math.min(8, Number(povCount) || 0));
  if (!cleanKey) throw new Error("Missing Moment reservation key.");

  if (count < 2) {
    return {
      allowed: true,
      counted: false,
      existing: false,
      quota: await momentSaveQuotaForUser(user)
    };
  }

  const plan = effectivePlan(user);
  const periodKey = momentSavePeriodKey();
  return withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`gamesloth-moment-save:${user.id}:${periodKey}`]
    );

    const existing = await client.query(
      `SELECT 1
         FROM moment_save_usage
        WHERE user_id = $1 AND period_key = $2 AND moment_key = $3
        LIMIT 1`,
      [user.id, periodKey, cleanKey]
    );

    if (existing.rowCount) {
      return {
        allowed: true,
        counted: true,
        existing: true,
        quota: await momentSaveQuotaForUser(user, client)
      };
    }

    const quota = await momentSaveQuotaForUser(user, client);
    if (plan === "FREE" && quota.remaining <= 0) {
      return {
        allowed: false,
        counted: false,
        existing: false,
        quota,
        code: "MONTHLY_MULTI_POV_LIMIT",
        message: `Free includes ${quota.limit} host-created multi-POV Moments per month. Upgrade the host to Sloth+ for unlimited saves.`
      };
    }

    await client.query(
      `INSERT INTO moment_save_usage
        (user_id, period_key, moment_key, source, pov_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, periodKey, cleanKey, cleanMomentSaveSource(source), count, Date.now()]
    );

    return {
      allowed: true,
      counted: true,
      existing: false,
      quota: await momentSaveQuotaForUser(user, client)
    };
  });
}

async function reserveMultiPovMomentSaveByUserId(userId, options) {
  const result = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
  const user = result.rows[0];
  if (!user) throw new Error("Host account was not found.");
  return reserveMultiPovMomentSave(user, options);
}

async function releaseFailedMultiPovMomentSave(userId, momentKey) {
  const cleanKey = cleanMomentSaveKey(momentKey);
  if (!userId || !cleanKey) return;
  await query(
    `DELETE FROM moment_save_usage
      WHERE user_id = $1 AND period_key = $2 AND moment_key = $3`,
    [userId, momentSavePeriodKey(), cleanKey]
  );
}

async function publicProductStats() {
  const [momentResult, founding] = await Promise.all([
    query(`SELECT COUNT(*)::bigint AS moments_created FROM moment_save_usage`),
    founding50Summary(null, false)
  ]);
  return {
    momentsCreated: Number(momentResult.rows[0]?.moments_created || 0),
    founding50Claimed: founding.claimed,
    founding50Remaining: founding.remaining,
    founding50Active: founding.active
  };
}

function addUtcYears(timestamp, years) {
  const source = new Date(Number(timestamp) || Date.now());
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCFullYear(source.getUTCFullYear() + Math.max(0, Number(years) || 0));
  source.setUTCMonth(month);
  const lastDay = new Date(Date.UTC(source.getUTCFullYear(), month + 1, 0)).getUTCDate();
  source.setUTCDate(Math.min(day, lastDay));
  return source.getTime();
}

function activeFounding50Reward(user, now = Date.now()) {
  if (!user || !Number(user.founding_50_position)) return false;
  const expiresAt = Number(user.founding_50_expires_at || 0);
  return !!expiresAt && expiresAt > now;
}

async function founding50Summary(client = null, includeWinners = true) {
  const db = client || { query };
  const settings = await alphaSettings(client);
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS claimed
       FROM founding_50_claims`
  );
  const claimed = Math.min(FOUNDING_50_LIMIT, Number(countResult.rows[0]?.claimed || 0));
  const summary = {
    enabled: !!settings.founding50Enabled,
    active: !!settings.founding50Enabled && claimed < FOUNDING_50_LIMIT,
    finished: claimed >= FOUNDING_50_LIMIT,
    limit: FOUNDING_50_LIMIT,
    claimed,
    remaining: Math.max(0, FOUNDING_50_LIMIT - claimed),
    rewardPlan: "SLOTH_PLUS",
    rewardYears: FOUNDING_50_REWARD_YEARS
  };

  if (!includeWinners) return summary;
  const winners = await db.query(
    `SELECT c.position, c.user_id, c.handle AS claim_handle, c.display_name AS claim_display_name,
            c.moment_key, c.pov_count, c.claimed_at, c.expires_at,
            u.id, u.display_name, u.handle, u.email, u.plan, u.subscription_status,
            u.alpha_plan_override, u.alpha_plan_override_expires_at,
            u.founding_50_position, u.founding_50_claimed_at, u.founding_50_expires_at,
            u.founding_50_moment_key, u.founding_50_pov_count
       FROM founding_50_claims c
       LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.position ASC
      LIMIT $1`,
    [FOUNDING_50_LIMIT]
  );
  return {
    ...summary,
    winners: winners.rows.map(row => ({
      id: row.id || `founding-${row.position}`,
      displayName: row.display_name || row.claim_display_name,
      handle: row.handle || row.claim_handle,
      email: row.email || "",
      position: Number(row.position),
      claimedAt: Number(row.claimed_at || 0),
      expiresAt: Number(row.expires_at || 0),
      momentKey: row.moment_key || "",
      povCount: Number(row.pov_count || 0),
      effectivePlan: row.id ? effectivePlan(row) : "SLOTH_PLUS",
      accountExists: !!row.id
    }))
  };
}

async function claimFounding50Reward(userId, { momentKey, povCount } = {}) {
  const cleanKey = cleanMomentSaveKey(momentKey);
  const readyPovs = Math.max(0, Math.min(16, Number(povCount) || 0));
  if (!userId || !cleanKey || readyPovs < 2) return { awarded: false, reason: "not_eligible" };

  return withTransaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [FOUNDING_50_ADVISORY_LOCK]);
    const settings = await alphaSettings(client);
    const userResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`, [userId]);
    const user = userResult.rows[0];
    if (!user) return { awarded: false, reason: "account_not_found" };

    const existingClaim = await client.query(
      `SELECT position, expires_at FROM founding_50_claims WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (Number(user.founding_50_position || 0) > 0 || existingClaim.rowCount) {
      return {
        awarded: false,
        existing: true,
        position: Number(existingClaim.rows[0]?.position || user.founding_50_position || 0),
        expiresAt: Number(existingClaim.rows[0]?.expires_at || user.founding_50_expires_at || 0),
        reason: "already_claimed"
      };
    }
    if (!settings.founding50Enabled) return { awarded: false, reason: "paused" };

    const positionResult = await client.query(
      `SELECT slot::int AS position
         FROM generate_series(1, $1) AS slot
         LEFT JOIN founding_50_claims c ON c.position = slot
        WHERE c.position IS NULL
        ORDER BY slot ASC
        LIMIT 1`,
      [FOUNDING_50_LIMIT]
    );
    const position = Number(positionResult.rows[0]?.position || 0);
    if (!position) return { awarded: false, reason: "full" };

    const claimedAt = Date.now();
    const expiresAt = addUtcYears(claimedAt, FOUNDING_50_REWARD_YEARS);
    await client.query(
      `INSERT INTO founding_50_claims
        (position, user_id, handle, display_name, moment_key, pov_count, claimed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [position, userId, user.handle, user.display_name, cleanKey, readyPovs, claimedAt, expiresAt]
    );
    const updated = await client.query(
      `UPDATE users
          SET founding_50_position = $1,
              founding_50_claimed_at = $2,
              founding_50_expires_at = $3,
              founding_50_moment_key = $4,
              founding_50_pov_count = $5,
              updated_at = $2
        WHERE id = $6 AND founding_50_position IS NULL
        RETURNING *`,
      [position, claimedAt, expiresAt, cleanKey, readyPovs, userId]
    );
    if (!updated.rowCount) return { awarded: false, reason: "already_claimed" };

    return {
      awarded: true,
      position,
      claimedAt,
      expiresAt,
      povCount: readyPovs,
      plan: "SLOTH_PLUS",
      user: accountUser(updated.rows[0])
    };
  });
}

function activeComplimentaryPlan(user, now = Date.now()) {
  if (!user) return null;
  const rawPlan = String(user.alpha_plan_override || "").toUpperCase();
  if (!["SLOTH_PLUS", "SLOTH_PRO"].includes(rawPlan)) return null;
  const expiresAt = Number(user.alpha_plan_override_expires_at || 0);
  if (expiresAt && expiresAt <= now) return null;
  return rawPlan;
}

function effectivePlan(user) {
  if (!user) return "FREE";
  const handle = normalizeHandle(user.handle);
  const candidates = [normalizedPlan(user.plan)];

  const complimentaryPlan = activeComplimentaryPlan(user);
  if (complimentaryPlan) candidates.push(complimentaryPlan);
  if (activeFounding50Reward(user)) candidates.push("SLOTH_PLUS");
  if (ALPHA_SLOTH_PLUS_HANDLES.has(handle)) candidates.push("SLOTH_PLUS");
  if (ALPHA_SLOTH_PRO_HANDLES.has(handle) || ALPHA_CREATOR_HANDLES.has(handle)) candidates.push("SLOTH_PRO");

  const rank = { FREE: 0, SLOTH_PLUS: 1, SLOTH_PRO: 2 };
  return candidates.reduce((best, plan) => rank[plan] > rank[best] ? plan : best, "FREE");
}

function entitlementsForUser(user) {
  const plan = effectivePlan(user);
  const pro = plan === "SLOTH_PRO";
  const plus = plan === "SLOTH_PLUS" || pro;

  return {
    plan,
    slothPlus: plus,
    slothPro: pro,
    creator: plus,
    adsEnabled: !plus,
    limits: planLimits(plan),
    features: {
      adFree: plus,
      separateMicTrack: plus,
      quickEditPro: plus,
      autoShorts: plus,
      aiCaptions: plus,
      creatorExport: plus,
      slothDirector: pro,
      advancedAudio: pro,
      batchPovExport: pro,
      cinematicCuts: pro,
      povTiming: pro
    }
  };
}

function planFromPriceId(priceId) {
  const id = String(priceId || "");
  for (const [plan, cycles] of Object.entries(PRICE_IDS)) {
    for (const configured of Object.values(cycles)) {
      if (configured && configured === id) return normalizedPlan(plan);
    }
  }
  return null;
}

function checkoutPrice(plan, cycle) {
  const normalized = normalizedPlan(plan);
  if (!["SLOTH_PLUS", "SLOTH_PRO"].includes(normalized)) return null;
  const billingCycle = cycle === "annual" ? "annual" : "monthly";
  return PRICE_IDS[normalized]?.[billingCycle] || null;
}

async function updateUserSubscription({
  userId = null,
  customerId = null,
  subscriptionId = null,
  status = null,
  priceId = null,
  plan = null
}) {
  const effectivePlanValue = plan || planFromPriceId(priceId);

  const conditions = [];
  const params = [];

  if (userId) {
    params.push(userId);
    conditions.push(`id = $${params.length}`);
  }
  if (customerId) {
    params.push(customerId);
    conditions.push(`stripe_customer_id = $${params.length}`);
  }

  if (!conditions.length) return null;

  const updates = [];
  const values = [];

  function setField(column, value) {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  }

  if (customerId) setField("stripe_customer_id", customerId);
  if (subscriptionId !== undefined) setField("stripe_subscription_id", subscriptionId);
  if (status !== undefined) setField("subscription_status", status);
  if (priceId !== undefined) setField("subscription_price_id", priceId);

  if (effectivePlanValue) {
    const active = ["active", "trialing", "past_due", null, undefined].includes(status);
    setField("plan", active ? effectivePlanValue : "FREE");
  } else if (status && ["canceled", "unpaid", "incomplete_expired"].includes(status)) {
    setField("plan", "FREE");
  }

  setField("plan_updated_at", Date.now());

  const whereStart = values.length;
  const shiftedConditions = conditions.map((condition, index) =>
    condition.replace(/\$(\d+)/g, (_, n) => `$${whereStart + Number(n)}`)
  );
  const allParams = [...values, ...params];

  const result = await query(
    `UPDATE users SET ${updates.join(", ")}
      WHERE ${shiftedConditions.join(" OR ")}
      RETURNING *`,
    allParams
  );

  return result.rows[0] || null;
}

async function syncStripeSubscription(subscription) {
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id || null;

  const priceId =
    subscription.items?.data?.[0]?.price?.id ||
    subscription.items?.data?.[0]?.plan?.id ||
    null;

  const plan =
    normalizedPlan(subscription.metadata?.gamesloth_plan) !== "FREE"
      ? normalizedPlan(subscription.metadata?.gamesloth_plan)
      : planFromPriceId(priceId);

  const userId = subscription.metadata?.gamesloth_user_id || null;

  return updateUserSubscription({
    userId,
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    priceId,
    plan
  });
}

async function handleStripeEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId =
        session.client_reference_id ||
        session.metadata?.gamesloth_user_id ||
        null;
      const plan = normalizedPlan(session.metadata?.gamesloth_plan);
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

      if (subscriptionId && stripe) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncStripeSubscription(subscription);
      } else if (userId && plan !== "FREE") {
        await updateUserSubscription({
          userId,
          customerId,
          subscriptionId: subscriptionId || null,
          status: "active",
          plan
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscription(event.data.object);
      break;

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id || invoice.parent?.subscription_details?.subscription || null;
      if (subscriptionId && stripe) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncStripeSubscription(subscription);
      }
      break;
    }

    default:
      break;
  }
}


function safeStringEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function hasAdsAdminAccess(req) {
  if (!ADS_ADMIN_TOKEN) return false;
  return safeStringEqual(req.headers["x-ads-admin-token"], ADS_ADMIN_TOKEN);
}



function hasFeedbackAdminAccess(req) {
  if (!FEEDBACK_ADMIN_TOKEN) return false;
  const supplied = req.headers["x-feedback-admin-token"] || req.headers["x-ads-admin-token"];
  return safeStringEqual(supplied, FEEDBACK_ADMIN_TOKEN);
}

function hasAlphaAdminAccess(req) {
  if (!ALPHA_ADMIN_TOKEN) return false;
  const supplied = req.headers["x-alpha-admin-token"] || req.headers["x-feedback-admin-token"] || req.headers["x-ads-admin-token"];
  return safeStringEqual(supplied, ALPHA_ADMIN_TOKEN);
}

function feedbackVisitorKey(req) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256")
    .update(`${ADS_TRACKING_SALT}|feedback|${requestIp(req)}|${day}`)
    .digest("hex");
}

function cleanFeedbackChoice(value, allowed, fallback) {
  const cleaned = String(value || "").trim().toLowerCase();
  return allowed.includes(cleaned) ? cleaned : fallback;
}

function cleanFeedbackText(value, maxLength) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, maxLength);
}

function feedbackAdminPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameSloth Alpha Feedback</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0a0e0b;color:#eef5ef;font:14px system-ui;padding:28px}.wrap{max-width:1180px;margin:auto}h1{margin:0 0 5px}h2{margin:0}.muted{color:#91a096}.card{background:#101711;border:1px solid #263529;border-radius:14px;padding:16px;margin-top:14px}input,select,button,textarea{font:inherit}input,select,textarea{width:100%;background:#0a100c;color:#eef5ef;border:1px solid #304236;border-radius:9px;padding:10px}button{background:#78c889;color:#071009;border:0;border-radius:9px;padding:10px 14px;font-weight:850;cursor:pointer}.ghost{background:#172019;color:#e7efe8;border:1px solid #33463a}.row{display:flex;gap:10px;align-items:center}.row>*{flex:1}.toolbar{display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;margin-top:12px}.stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pill{display:inline-flex;gap:5px;align-items:center;border:1px solid #304236;border-radius:999px;padding:5px 9px;color:#a9b7ad}.list{display:grid;gap:12px;margin-top:14px}.item{border:1px solid #2a3a2e;border-radius:13px;padding:16px;background:#0c130e}.item-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.item h3{margin:5px 0 6px;font-size:18px}.meta{display:flex;gap:8px;flex-wrap:wrap;color:#8fa096;font-size:12px}.tag{border-radius:999px;padding:3px 7px;background:#1b2d20;color:#a8e4b4;font-size:11px}.severity-blocker{background:#4b1e22;color:#ffb8bf}.severity-high{background:#483415;color:#ffd49a}.body{white-space:pre-wrap;color:#c2cec5;line-height:1.55;margin-top:13px}.details{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:13px}.detail{border-top:1px solid #243329;padding-top:10px}.detail b{display:block;color:#91a096;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.actions{display:flex;gap:8px;align-items:center;min-width:230px}.actions select{min-width:130px}.empty{padding:30px;text-align:center;color:#91a096}.hidden{display:none!important}a{color:#8bdd9b}@media(max-width:760px){body{padding:15px}.row,.item-head{flex-direction:column}.toolbar{grid-template-columns:1fr}.details{grid-template-columns:1fr}.actions{width:100%;min-width:0}}
</style></head><body><div class="wrap"><h1>GameSloth Alpha Feedback</h1><p class="muted">Review tester reports submitted through gamesloth.app.</p>
<div class="card"><label>Admin token</label><div class="row"><input id="token" type="password" placeholder="FEEDBACK_ADMIN_TOKEN or ADS_ADMIN_TOKEN" autocomplete="off"><button id="connect" type="button">Connect</button></div><p id="status" class="muted" aria-live="polite"></p></div>
<div id="manager" class="hidden"><div class="card"><div class="row"><div><h2>Submissions</h2><p class="muted">Newest reports first. Status changes are saved to PostgreSQL.</p></div><button id="csv" class="ghost" type="button">Download CSV</button></div><div class="toolbar"><select id="statusFilter"><option value="all">All statuses</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="planned">Planned</option><option value="fixed">Fixed</option><option value="closed">Closed</option></select><select id="categoryFilter"><option value="all">All categories</option><option value="bug">Bug</option><option value="suggestion">Suggestion</option><option value="usability">Usability</option><option value="performance">Performance</option><option value="account">Account</option><option value="sync">Sloth Sync</option><option value="billing">Billing</option><option value="ads">Ads</option><option value="other">Other</option></select><button id="refresh" class="ghost" type="button">Refresh</button><button id="clear" class="ghost" type="button">Clear filters</button></div><div id="stats" class="stats"></div><div id="list" class="list"></div></div></div>
<script>
(function(){
const q=function(id){return document.getElementById(id)};
let items=[];
function esc(value){return String(value==null?'':value).replace(/[&<>\"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]})}
function headers(){return {'Content-Type':'application/json','X-Feedback-Admin-Token':q('token').value}}
async function api(path,method,body){const response=await fetch(path,{method:method||'GET',headers:headers(),body:body?JSON.stringify(body):undefined});const data=await response.json().catch(function(){return {}});if(!response.ok)throw new Error(data.message||'Request failed');return data}
function setStatus(message,isError){q('status').textContent=message;q('status').style.color=isError?'#ff9aa5':'#91a096'}
function formatDate(value){try{return new Date(Number(value)).toLocaleString()}catch{return String(value||'')}}
function detail(label,value){if(!value)return '';return '<div class="detail"><b>'+esc(label)+'</b><div class="body">'+esc(value)+'</div></div>'}
function render(){
 const list=q('list');
 if(!items.length){list.innerHTML='<div class="empty">No feedback matches these filters.</div>';return}
 list.innerHTML=items.map(function(item){
  const severityClass=item.severity==='blocker'?' severity-blocker':item.severity==='high'?' severity-high':'';
  const contact=[item.testerName,item.handle?('@'+item.handle):'',item.email].filter(Boolean).join(' · ');
  return '<article class="item"><div class="item-head"><div><div class="meta"><span class="tag">'+esc(item.category)+'</span><span class="tag'+severityClass+'">'+esc(item.severity)+'</span><span class="tag">'+esc(item.area)+'</span><span>'+esc(item.appVersion||'version unknown')+'</span><span>'+esc(formatDate(item.createdAt))+'</span></div><h3>'+esc(item.title)+'</h3><div class="meta"><span>'+esc(item.id)+'</span><span>'+esc(contact||'Anonymous tester')+'</span><span>'+esc(item.source)+'</span></div></div><div class="actions"><select data-status="'+esc(item.id)+'"><option value="new"'+(item.status==='new'?' selected':'')+'>New</option><option value="reviewing"'+(item.status==='reviewing'?' selected':'')+'>Reviewing</option><option value="planned"'+(item.status==='planned'?' selected':'')+'>Planned</option><option value="fixed"'+(item.status==='fixed'?' selected':'')+'>Fixed</option><option value="closed"'+(item.status==='closed'?' selected':'')+'>Closed</option></select><button data-save="'+esc(item.id)+'" type="button">Save</button></div></div><div class="body">'+esc(item.description)+'</div><div class="details">'+detail('Steps to reproduce',item.steps)+detail('Expected',item.expected)+detail('Actual',item.actual)+detail('Device / setup',item.deviceInfo)+detail('Screenshot link',item.screenshotUrl)+detail('Contact allowed',item.contactAllowed?'Yes':'No')+'</div></article>'
 }).join('');
 document.querySelectorAll('[data-save]').forEach(function(button){button.addEventListener('click',async function(){const id=button.getAttribute('data-save');const select=document.querySelector('[data-status="'+CSS.escape(id)+'"]');button.disabled=true;try{await api('/api/admin/feedback/status','POST',{id:id,status:select.value});setStatus('Saved '+id,false);await load()}catch(error){setStatus(error.message,true)}finally{button.disabled=false}})});
}
function renderStats(counts,total){const order=['new','reviewing','planned','fixed','closed'];q('stats').innerHTML='<span class="pill"><b>'+esc(total)+'</b> total</span>'+order.map(function(key){return '<span class="pill"><b>'+esc(counts[key]||0)+'</b> '+esc(key)+'</span>'}).join('')}
async function load(){
 const params=new URLSearchParams();params.set('status',q('statusFilter').value);params.set('category',q('categoryFilter').value);params.set('limit','300');
 const data=await api('/api/admin/feedback/submissions?'+params.toString());items=data.submissions||[];renderStats(data.counts||{},data.total||0);render();q('manager').classList.remove('hidden');setStatus('Connected · server '+(data.version||''),false)
}
function csvCell(value){const text=String(value==null?'':value);return '"'+text.replace(/"/g,'""')+'"'}
function downloadCsv(){const fields=['id','createdAt','status','category','severity','area','title','description','steps','expected','actual','testerName','handle','email','appVersion','deviceInfo','screenshotUrl','source','contactAllowed'];const rows=[fields.join(',')].concat(items.map(function(item){return fields.map(function(field){return csvCell(item[field])}).join(',')}));const blob=new Blob([rows.join('\\r\\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='gamesloth-alpha-feedback.csv';link.click();setTimeout(function(){URL.revokeObjectURL(url)},1000)}
q('connect').addEventListener('click',function(){load().catch(function(error){setStatus(error.message,true)})});q('token').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();q('connect').click()}});q('refresh').addEventListener('click',function(){load().catch(function(error){setStatus(error.message,true)})});q('statusFilter').addEventListener('change',function(){load().catch(function(error){setStatus(error.message,true)})});q('categoryFilter').addEventListener('change',function(){load().catch(function(error){setStatus(error.message,true)})});q('clear').addEventListener('click',function(){q('statusFilter').value='all';q('categoryFilter').value='all';load().catch(function(error){setStatus(error.message,true)})});q('csv').addEventListener('click',downloadCsv);window.addEventListener('error',function(event){setStatus('Admin page error: '+event.message,true)});
})();
</script></div></body></html>`;
}

function cleanAdPlacement(value) {
  const placement = String(value || "").toLowerCase();
  return ["clips", "moments"].includes(placement) ? placement : null;
}

function adVisitorKey(req, user) {
  if (user?.id) return `user:${user.id}`;
  const day = new Date().toISOString().slice(0, 10);
  return `anon:${crypto.createHash("sha256").update(`${ADS_TRACKING_SALT}|${requestIp(req)}|${day}`).digest("hex")}`;
}

function publicCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label || "Sponsored",
    headline: row.headline,
    description: row.description,
    buttonLabel: row.button_label || "View offer",
    actionType: row.action_type || "external",
    actionValue: row.action_value || null,
    logoUrl: row.logo_url || null,
    bannerUrl: row.banner_url || null,
    brandColor: row.brand_color || null,
    placement: row.selected_placement || null,
    sponsor: row.sponsor || null
  };
}

async function nextAdCampaign({ placement, visitorKey }) {
  const result = await query(
    `SELECT c.*, $1::text AS selected_placement
       FROM ad_campaigns c
      WHERE c.active = TRUE
        AND $1 = ANY(c.placements)
        AND (c.starts_at IS NULL OR c.starts_at <= $2)
        AND (c.ends_at IS NULL OR c.ends_at >= $2)
        AND NOT EXISTS (
          SELECT 1
            FROM ad_events e
           WHERE e.campaign_id = c.id
             AND e.placement = $1
             AND e.visitor_key = $3
             AND e.event_type = 'impression'
             AND e.occurred_at >= $2 - (GREATEST(c.frequency_cap_hours, 1) * 60 * 60 * 1000)
        )
      ORDER BY RANDOM() * GREATEST(c.weight, 1) DESC
      LIMIT 1`,
    [placement, Date.now(), visitorKey]
  );
  return result.rows[0] || null;
}

async function recordAdEvent({ campaignId, placement, eventType, visitorKey, userId = null }) {
  if (!["impression", "click"].includes(eventType)) return false;
  const campaign = await query(
    `SELECT 1 FROM ad_campaigns WHERE id = $1 AND active = TRUE AND $2 = ANY(placements) LIMIT 1`,
    [campaignId, placement]
  );
  if (!campaign.rowCount) return false;

  if (eventType === "impression") {
    const duplicate = await query(
      `SELECT 1 FROM ad_events
        WHERE campaign_id = $1 AND placement = $2 AND visitor_key = $3
          AND event_type = 'impression' AND occurred_at > $4
        LIMIT 1`,
      [campaignId, placement, visitorKey, Date.now() - 30_000]
    );
    if (duplicate.rowCount) return true;
  }

  await query(
    `INSERT INTO ad_events (campaign_id, user_id, visitor_key, placement, event_type, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [campaignId, userId, visitorKey, placement, eventType, Date.now()]
  );
  return true;
}

function adsAdminPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameSloth Ads Admin</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0d11;color:#eef2f3;font:14px system-ui;padding:28px}.wrap{max-width:1120px;margin:auto}h1{margin:0 0 5px}h2{margin-top:0}.muted{color:#98a3ad}.help{display:block;color:#7f8c96;font-size:12px;line-height:1.45;margin-top:5px}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;background:#141920;color:#eef2f3;border:1px solid #303944;border-radius:9px;padding:10px}textarea{min-height:80px;resize:vertical}button{background:#6fbd80;color:#071009;border:0;border-radius:9px;padding:10px 14px;font-weight:800;cursor:pointer}.ghost{background:#1a2028;color:#e8edef;border:1px solid #333d48}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.full{grid-column:1/-1}.card{background:#12161c;border:1px solid #252d36;border-radius:14px;padding:16px;margin-top:14px}.row{display:flex;gap:10px;align-items:center}.row>*{flex:1}.campaign{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;border-top:1px solid #262e37;padding:13px 0}.campaign:first-child{border-top:0}.campaign-head{display:flex;align-items:center;gap:8px}.campaign-thumb{width:54px;height:36px;border-radius:7px;object-fit:cover;background:#0c1116;border:1px solid #29323b}.badge{display:inline-block;background:#1c3424;color:#9fe2ad;padding:3px 7px;border-radius:999px;font-size:11px}.stats{font-size:12px;color:#9aa6af}.hidden{display:none!important}.preview-shell{margin-top:14px}.preview-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}.ad-preview{--accent:#73bd82;position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,34%);min-height:132px;border:1px solid #29323b;border-radius:14px;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 9%,#12171d),#0f1318 64%)}.ad-preview:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--accent)}.preview-content{display:flex;align-items:center;gap:13px;padding:18px 18px 18px 21px;min-width:0}.preview-logo{width:58px;height:58px;border-radius:12px;object-fit:contain;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);padding:7px;flex:0 0 auto}.preview-copy{min-width:0;flex:1}.preview-copy small{display:block;color:#91a0a9;font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase}.preview-copy strong{display:block;margin-top:7px;font-size:18px}.preview-copy span{display:block;margin-top:5px;color:#a1adb5;line-height:1.45}.preview-button{margin-top:12px;display:inline-block;background:var(--accent);color:#061009;border-radius:8px;padding:8px 11px;font-weight:850;font-size:12px}.preview-banner{width:100%;height:100%;min-height:132px;object-fit:cover;border-left:1px solid rgba(255,255,255,.07);background:#0c1116}.asset-tip{padding:10px 12px;border:1px solid #2a333d;border-radius:10px;background:#0d1217;color:#93a0a9;font-size:12px;line-height:1.5}.asset-tip strong{color:#dce6ea}.color-row{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:8px}.color-row input[type=color]{padding:4px;height:41px}.actions{display:flex;justify-content:flex-end;margin-top:14px}@media(max-width:760px){body{padding:16px}.grid{grid-template-columns:1fr}.full{grid-column:auto}.row{flex-direction:column}.campaign{grid-template-columns:1fr}.ad-preview{grid-template-columns:1fr}.preview-banner{min-height:170px;border-left:0;border-top:1px solid rgba(255,255,255,.07)}}
</style></head><body><div class="wrap"><h1>GameSloth Ads Admin</h1><p class="muted">Manage sponsor cards shown only to Free users in Clips and Moments.</p>
<div class="card"><label>Admin token</label><div class="row"><input id="token" type="password" placeholder="ADS_ADMIN_TOKEN" autocomplete="off"><button id="connectButton" type="button">Connect</button></div><p id="status" class="muted" aria-live="polite"></p></div>
<div id="manager" class="hidden"><div class="card"><h2>Create or update campaign</h2><div class="grid">
<label>Campaign ID<input id="id" placeholder="sponsor-name-001"></label><label>Sponsor<input id="sponsor" placeholder="GameSloth or sponsor name"></label>
<label>Label<input id="label" value="Sponsored"></label><label>Button label<input id="buttonLabel" value="View offer"></label>
<label>Headline<input id="headline" placeholder="Upgrade your setup"></label><label>Action<select id="actionType"><option value="external">External HTTPS link</option><option value="plans">Open GameSloth Plans</option></select></label>
<label class="full">Description<textarea id="description"></textarea></label><label class="full">HTTPS target URL<input id="actionValue" placeholder="https://..."></label>
<label>Logo URL (optional)<input id="logoUrl" placeholder="https://gamesloth.app/ads/sponsor-logo.png"><span class="help">Square transparent PNG or WebP recommended.</span></label>
<label>Banner URL (optional)<input id="bannerUrl" placeholder="https://gamesloth.app/ads/sponsor-banner.jpg"><span class="help">Recommended ratio 3:1, for example 1200 × 400.</span></label>
<label>Brand accent<div class="color-row"><input id="brandColor" value="#73BD82" maxlength="7"><input id="brandColorPicker" type="color" value="#73bd82"></div></label>
<label>Placements<select id="placements" multiple size="2"><option value="clips" selected>Clips</option><option value="moments" selected>Moments</option></select></label>
<label>Weight<input id="weight" type="number" min="1" max="100" value="10"></label><label>Frequency cap (hours)<input id="frequency" type="number" min="1" max="720" value="12"></label><label>Active<select id="active"><option value="true">Yes</option><option value="false">No</option></select></label>
<div class="full asset-tip"><strong>Use approved sponsor assets only.</strong> Host images on GameSloth or a trusted sponsor CDN and paste direct HTTPS image URLs. Broken images automatically fall back to a clean text-only card in the desktop app.</div>
</div>
<div class="preview-shell"><div class="preview-title"><strong>Live preview</strong><span class="muted">Updates while you type</span></div><div id="preview" class="ad-preview"><div class="preview-content"><img id="previewLogo" class="preview-logo hidden" alt=""><div class="preview-copy"><small id="previewLabel">Sponsored</small><strong id="previewHeadline">Your sponsor headline</strong><span id="previewDescription">Your sponsor description appears here.</span><b id="previewButton" class="preview-button">View offer</b></div></div><img id="previewBanner" class="preview-banner hidden" alt=""></div></div>
<div class="actions"><button id="saveButton" type="button">Save campaign</button></div></div><div class="card"><h2>Campaigns</h2><div id="campaigns"></div></div></div>
<script>
const q=id=>document.getElementById(id);
const headers=()=>({'Content-Type':'application/json','X-Ads-Admin-Token':q('token').value.trim()});
function setStatus(message,isError=false){q('status').textContent=message;q('status').style.color=isError?'#ff8c8c':'#98a3ad'}
async function api(path,method='GET',body){
  const r=await fetch(path,{method,headers:headers(),body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const text=await r.text();let d={};
  try{d=text?JSON.parse(text):{}}catch{throw new Error('Server returned an unreadable response (HTTP '+r.status+').')}
  if(!r.ok)throw new Error(d.message||('Request failed (HTTP '+r.status+').'));
  return d;
}
function esc(v){return String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]))}
function cleanImageUrl(v){v=String(v||'').trim();return v.toLowerCase().startsWith('https://')?v:''}
function cleanColor(v){v=String(v||'').trim();return /^#[0-9a-f]{6}$/i.test(v)?v.toUpperCase():'#73BD82'}
function setPreviewImage(img,url){img.classList.add('hidden');img.removeAttribute('src');if(!url)return;img.onload=()=>img.classList.remove('hidden');img.onerror=()=>{img.classList.add('hidden');img.removeAttribute('src')};img.src=url}
function updatePreview(){const color=cleanColor(q('brandColor').value);q('preview').style.setProperty('--accent',color);q('brandColorPicker').value=color.toLowerCase();q('previewLabel').textContent=q('label').value.trim()||'Sponsored';q('previewHeadline').textContent=q('headline').value.trim()||'Your sponsor headline';q('previewDescription').textContent=q('description').value.trim()||'Your sponsor description appears here.';q('previewButton').textContent=q('buttonLabel').value.trim()||'View offer';setPreviewImage(q('previewLogo'),cleanImageUrl(q('logoUrl').value));setPreviewImage(q('previewBanner'),cleanImageUrl(q('bannerUrl').value))}
async function loadCampaigns(){
  const button=q('connectButton');
  if(!q('token').value.trim()){setStatus('Paste the ADS_ADMIN_TOKEN first.',true);return}
  button.disabled=true;button.textContent='Connecting…';setStatus('Checking token…');
  try{
    const ping=await api('/api/admin/ads/ping');
    setStatus('Token accepted. Loading campaigns…');
    const d=await api('/api/admin/ads/campaigns');
    q('manager').classList.remove('hidden');
    setStatus('Connected to Ads Admin v'+(ping.version||'0.32.5'));
    q('campaigns').innerHTML=d.campaigns.map(c=>'<div class="campaign"><div><div class="campaign-head">'+(c.bannerUrl?'<img class="campaign-thumb" src="'+esc(c.bannerUrl)+'" alt="">':'')+'<div><span class="badge">'+esc(c.active?'ACTIVE':'PAUSED')+'</span> <strong>'+esc(c.headline)+'</strong><div class="muted">'+esc(c.id)+' · '+esc(c.placements.join(', '))+' · '+esc(c.actionType)+'</div></div></div><div class="stats">'+c.impressions+' impressions · '+c.clicks+' clicks · '+c.ctr+'% CTR</div></div><button class="ghost" data-id="'+esc(c.id)+'">Edit</button></div>').join('')||'<p class="muted">No campaigns.</p>';
    [...q('campaigns').querySelectorAll('button[data-id]')].forEach(btn=>btn.onclick=()=>edit(d.campaigns.find(c=>c.id===btn.dataset.id)));
  }catch(e){q('manager').classList.add('hidden');setStatus('Connection failed: '+(e.message||'Unknown error'),true)}
  finally{button.disabled=false;button.textContent='Connect'}
}
function edit(c){if(!c)return;['id','sponsor','label','buttonLabel','headline','description','actionType','actionValue','logoUrl','bannerUrl','brandColor','weight'].forEach(k=>q(k).value=c[k]??'');q('frequency').value=c.frequencyCapHours??12;q('active').value=String(c.active);[...q('placements').options].forEach(o=>o.selected=c.placements.includes(o.value));updatePreview();scrollTo({top:0,behavior:'smooth'})}
async function saveCampaign(){try{const placements=[...q('placements').selectedOptions].map(o=>o.value);await api('/api/admin/ads/campaigns','POST',{id:q('id').value,sponsor:q('sponsor').value,label:q('label').value,buttonLabel:q('buttonLabel').value,headline:q('headline').value,description:q('description').value,actionType:q('actionType').value,actionValue:q('actionValue').value,logoUrl:q('logoUrl').value,bannerUrl:q('bannerUrl').value,brandColor:q('brandColor').value,placements,weight:Number(q('weight').value),frequencyCapHours:Number(q('frequency').value),active:q('active').value==='true'});setStatus('Campaign saved.');await loadCampaigns()}catch(e){alert(e.message)}}
['label','buttonLabel','headline','description','logoUrl','bannerUrl','brandColor'].forEach(id=>q(id).addEventListener('input',updatePreview));
q('brandColorPicker').addEventListener('input',()=>{q('brandColor').value=q('brandColorPicker').value.toUpperCase();updatePreview()});
q('connectButton').addEventListener('click',loadCampaigns);
q('saveButton').addEventListener('click',saveCampaign);
q('token').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadCampaigns()}});
window.addEventListener('error',event=>setStatus('Admin page error: '+event.message,true));
updatePreview();
</script></div></body></html>`;
}



function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function transactionalEmailConfigured() {
  return !!(RESEND_API_KEY && EMAIL_FROM);
}

async function sendTransactionalEmail({ to, subject, text, html: htmlBody, idempotencyKey }) {
  if (!transactionalEmailConfigured()) return { sent: false, reason: "not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {})
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [String(to)],
      subject: String(subject),
      ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
      text: String(text || ""),
      html: String(htmlBody || "")
    })
  });
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch { }
  if (!response.ok) throw new Error(data.message || `Email provider returned HTTP ${response.status}.`);
  return { sent: true, id: data.id || null };
}

async function createPasswordResetForUser(user, { sendEmail = true } = {}) {
  const rawToken = createToken();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
  await withTransaction(async client => {
    await client.query(`UPDATE password_reset_tokens SET used_at = COALESCE(used_at, $1) WHERE user_id = $2 AND used_at IS NULL`, [now, user.id]);
    await client.query(`INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, used_at) VALUES ($1, $2, $3, $4, NULL)`, [tokenHash, user.id, now, expiresAt]);
  });
  const link = `${WEBSITE_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
  let delivery = { sent: false, reason: "not_requested" };
  if (sendEmail) {
    delivery = await sendTransactionalEmail({
      to: user.email,
      subject: "Reset your GameSloth password",
      idempotencyKey: `password-reset-${tokenHash}`,
      text: `Reset your GameSloth password: ${link}\n\nThis link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.`,
      html: `<h1>Reset your GameSloth password</h1><p><a href="${escapeHtml(link)}">Reset password</a></p><p>This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.</p>`
    });
  }
  return { link, expiresAt, delivery };
}

async function createEmailVerificationForUser(user, { sendEmail = true } = {}) {
  if (user.email_verified_at) return { alreadyVerified: true, link: null, delivery: { sent: false, reason: "already_verified" } };
  const rawToken = createToken();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000;
  await withTransaction(async client => {
    await client.query(`UPDATE email_verification_tokens SET used_at = COALESCE(used_at, $1) WHERE user_id = $2 AND used_at IS NULL`, [now, user.id]);
    await client.query(`INSERT INTO email_verification_tokens (token_hash, user_id, created_at, expires_at, used_at) VALUES ($1, $2, $3, $4, NULL)`, [tokenHash, user.id, now, expiresAt]);
  });
  const link = `${WEBSITE_BASE_URL}/verify-email?token=${encodeURIComponent(rawToken)}`;
  let delivery = { sent: false, reason: "not_requested" };
  if (sendEmail) {
    delivery = await sendTransactionalEmail({
      to: user.email,
      subject: "Verify your GameSloth email",
      idempotencyKey: `email-verify-${tokenHash}`,
      text: `Verify your GameSloth email: ${link}\n\nThis link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.`,
      html: `<h1>Verify your GameSloth email</h1><p><a href="${escapeHtml(link)}">Verify email address</a></p><p>This link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.</p>`
    });
  }
  return { link, expiresAt, delivery };
}

function hasBackupAdminAccess(req) {
  if (!BACKUP_ADMIN_TOKEN) return false;
  const supplied = req.headers["x-backup-admin-token"] || req.headers["x-alpha-admin-token"];
  return safeStringEqual(supplied, BACKUP_ADMIN_TOKEN);
}

async function databaseSnapshot() {
  const tableResult = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const tables = {};
  for (const row of tableResult.rows) {
    const name = String(row.table_name || "");
    if (!/^[a-z0-9_]+$/i.test(name)) continue;
    const result = await query(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
    tables[name] = result.rows;
  }
  return { format: "gamesloth-json-backup-v1", createdAt: new Date().toISOString(), serverVersion: SERVER_VERSION, tables };
}

// Alpha Admin interface; account APIs and authorization remain in this server.
const { alphaAdminPage, alphaAdminScript } = require("./alpha-admin-ui");

const revokedSessionTokens = new Map();

async function invalidateUserSessions(userId, reason = "CONCURRENT_LOGIN", deviceName = "another device") {
  if (!userId) return;
  try {
    const prev = await query(`SELECT token_hash FROM sessions WHERE user_id = $1`, [userId]);
    for (const row of prev.rows) {
      revokedSessionTokens.set(row.token_hash, {
        reason,
        deviceName,
        revokedAt: Date.now()
      });
    }
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  } catch (err) {
    console.error("[auth] could not invalidate sessions", err);
  }

  try {
    if (typeof disconnectUserFromAllRooms === "function") {
      disconnectUserFromAllRooms(userId, "Logged out: Your account was signed in on another device.");
    }
  } catch { }

  if (revokedSessionTokens.size > 5000) {
    const oldestKeys = Array.from(revokedSessionTokens.keys()).slice(0, 1000);
    for (const k of oldestKeys) revokedSessionTokens.delete(k);
  }
}

async function issueSession(userId, deviceName = "another device") {
  await invalidateUserSessions(userId, "CONCURRENT_LOGIN", deviceName);

  const rawToken = createToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

  await query(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(rawToken), userId, now, expiresAt]
  );

  return rawToken;
}

async function authenticatedUser(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;

  const rawToken = header.slice(7).trim();
  if (!rawToken) return null;

  const result = await query(
    `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > $2
        AND COALESCE(u.alpha_access_status, 'approved') = 'approved'
      LIMIT 1`,
    [hashToken(rawToken), Date.now()]
  );

  return result.rows[0] || null;
}

async function authenticatedUserFromToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const result = await query(
    `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > $2
        AND COALESCE(u.alpha_access_status, 'approved') = 'approved'
      LIMIT 1`,
    [hashToken(token), Date.now()]
  );

  return result.rows[0] || null;
}

async function isSquadMember(userId, squadId) {
  const result = await query(
    `SELECT 1
       FROM squad_members
      WHERE squad_id = $1 AND user_id = $2
      LIMIT 1`,
    [squadId, userId]
  );
  return !!result.rows[0];
}


async function friendsFor(userId) {
  const result = await query(
    `SELECT u.*
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = $1
      ORDER BY LOWER(u.display_name), u.handle`,
    [userId]
  );
  return result.rows.map(publicUser);
}

async function requestsFor(userId) {
  const result = await query(
    `SELECT u.*
       FROM friend_requests r
       JOIN users u ON u.id = r.from_user_id
      WHERE r.to_user_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users b
           WHERE b.user_id = $1 AND b.blocked_user_id = r.from_user_id
        )
      ORDER BY r.created_at ASC`,
    [userId]
  );
  return result.rows.map(publicUser);
}

async function isBlocked(userId, targetId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT 1 FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2 LIMIT 1`,
    [userId, targetId]
  );
  return result.rowCount > 0;
}

async function blockedFor(userId) {
  const result = await query(
    `SELECT u.*
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_user_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows.map(publicUser);
}

async function isFriend(userId, friendId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 LIMIT 1`,
    [userId, friendId]
  );
  return result.rowCount > 0;
}

async function squadById(squadId, runner = null) {
  const db = runner || { query };
  const result = await db.query(`SELECT * FROM squads WHERE id = $1 LIMIT 1`, [squadId]);
  return result.rows[0] || null;
}

async function squadView(squad, runner = null) {
  const db = runner || { query };
  const memberResult = await db.query(
    `SELECT u.*
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
      WHERE sm.squad_id = $1
      ORDER BY sm.created_at ASC`,
    [squad.id]
  );

  const pendingInviteResult = await db.query(
    `SELECT
       si.created_at,
       u.id,
       u.email,
       u.handle,
       u.display_name,
       u.plan,
       u.subscription_status
     FROM squad_invites si
     JOIN users u ON u.id = si.to_user_id
     WHERE si.squad_id = $1
     ORDER BY si.created_at ASC`,
    [squad.id]
  );

  const activeIsFresh =
    squad.active_room_code &&
    squad.active_room_updated_at &&
    Date.now() - Number(squad.active_room_updated_at) < ACTIVE_ROOM_TTL_MS;

  return {
    id: squad.id,
    name: squad.name,
    ownerId: squad.owner_id,
    members: memberResult.rows.map(publicUser),
    pendingInvites: pendingInviteResult.rows.map(row => ({
      user: publicUser(row),
      createdAt: Number(row.created_at)
    })),
    activeRoomCode: activeIsFresh ? squad.active_room_code : null,
    activeRoomUpdatedAt: activeIsFresh ? Number(squad.active_room_updated_at) : null
  };
}

async function squadsFor(userId) {
  const result = await query(
    `SELECT s.*
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
      WHERE sm.user_id = $1
      ORDER BY s.created_at ASC`,
    [userId]
  );

  const output = [];
  for (const squad of result.rows) {
    output.push(await squadView(squad));
  }
  return output;
}


async function squadInvitesFor(userId) {
  const result = await query(
    `SELECT
       si.squad_id,
       si.created_at,
       s.name AS squad_name,
       s.owner_id,
       u.id,
       u.email,
       u.handle,
       u.display_name,
       u.plan,
       u.subscription_status
     FROM squad_invites si
     JOIN squads s ON s.id = si.squad_id
     JOIN users u ON u.id = si.from_user_id
     WHERE si.to_user_id = $1
     ORDER BY si.created_at ASC`,
    [userId]
  );

  return result.rows.map(row => ({
    squadId: row.squad_id,
    squadName: row.squad_name,
    createdAt: Number(row.created_at),
    from: publicUser(row)
  }));
}

async function squadMembershipExists(squadId, userId) {
  const result = await query(
    `SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 LIMIT 1`,
    [squadId, userId]
  );
  return !!result.rows[0];
}

async function cleanupExpiredSessions() {
  try {
    await query(`DELETE FROM sessions WHERE expires_at <= $1`, [Date.now()]);
  } catch (err) {
    console.error("[sessions] cleanup failed", err.message);
  }
}

const server = http.createServer(async (req, res) => {
  res._gameslothRequest = req;
  const origin = allowedCorsOrigin(req);
  if (origin === null) return json(res, 403, { ok: false, message: "Origin is not allowed." });
  if (req.method === "OPTIONS") return json(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "POST" && url.pathname === "/stripe/webhook") {
      if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return json(res, 503, { ok: false, message: "Stripe webhook is not configured." });
      }

      const rawBody = await readRawBody(req);
      const signature = String(req.headers["stripe-signature"] || "");

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          signature,
          STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return json(res, 400, { ok: false, message: `Webhook signature error: ${err.message}` });
      }

      await handleStripeEvent(event);
      return json(res, 200, { received: true });
    }

    if (req.method === "GET" && url.pathname === "/download/windows") {
      let downloadUrl = ALPHA_DOWNLOAD_URL;
      try {
        downloadUrl = await latestWindowsDownloadUrl();
      } catch (err) {
        console.error("[download] latest installer lookup failed", err.message);
      }

      if (!/^https:\/\//i.test(downloadUrl)) {
        return json(res, 503, { ok: false, message: "The Windows download is temporarily unavailable." });
      }

      return redirect(res, downloadUrl);
    }

    if (req.method === "GET" && url.pathname === "/billing/success") {
      return html(res, 200, `<!doctype html><html><body style="background:#071017;color:#eaf3f5;font-family:system-ui;padding:48px"><h1>GameSloth upgrade complete ✓</h1><p>You can close this tab and return to GameSloth. Your plan will refresh automatically.</p></body></html>`);
    }

    if (req.method === "GET" && url.pathname === "/billing/cancel") {
      return html(res, 200, `<!doctype html><html><body style="background:#071017;color:#eaf3f5;font-family:system-ui;padding:48px"><h1>Checkout cancelled</h1><p>No changes were made to your GameSloth plan.</p></body></html>`);
    }


    if (req.method === "GET" && url.pathname === "/alpha/admin") {
      return html(res, 200, alphaAdminPage());
    }

    if (req.method === "GET" && url.pathname === "/alpha/admin.js") {
      const script = Buffer.from(alphaAdminScript());
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Content-Length": script.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end(script);
    }

    if (req.method === "GET" && url.pathname === "/api/alpha/status") {
      return json(res, 200, { ok: true, version: SERVER_VERSION, ...(await alphaAccessSummary()) });
    }

    if (req.method === "GET" && url.pathname === "/api/public/stats") {
      return json(res, 200, {
        ok: true,
        ...(await publicProductStats()),
        generatedAt: Date.now()
      });
    }

    if (req.method === "POST" && url.pathname === "/api/alpha/check-invite") {
      const summary = await alphaAccessSummary();
      return json(res, 200, {
        ok: true,
        valid: true,
        deprecated: true,
        phase: summary.phase,
        message: summary.approvalRequired
          ? "Invite codes are no longer used. Download GameSloth, create an account and wait for approval."
          : "GameSloth Open Beta is active. No invite code is required."
      });
    }

    if (req.method === "POST" && url.pathname === "/api/alpha/access-request") {
      const summary = await alphaAccessSummary();
      return json(res, 200, {
        ok: true,
        deprecated: true,
        phase: summary.phase,
        message: summary.approvalRequired
          ? "A separate access request is no longer needed. Download GameSloth and create an account; it will appear in Alpha Admin for approval."
          : "GameSloth Open Beta is active. Download the app and create an account directly."
      });
    }

    if (url.pathname.startsWith("/api/admin/alpha/")) {
      if (!hasAlphaAdminAccess(req)) return json(res, 401, { ok: false, message: "Invalid alpha admin token." });

      if (req.method === "GET" && url.pathname === "/api/admin/alpha/summary") {
        const [summary, founding50] = await Promise.all([alphaAccessSummary(), founding50Summary()]);
        const result = await query(
          `SELECT id, display_name, handle, email, email_verified_at, plan, subscription_status,
                  alpha_access_status, alpha_access_granted_at, alpha_reviewed_at, created_at,
                  alpha_plan_override, alpha_plan_override_expires_at, alpha_plan_override_note,
                  alpha_plan_override_updated_at, founding_50_position, founding_50_claimed_at,
                  founding_50_expires_at, founding_50_moment_key, founding_50_pov_count
             FROM users
            ORDER BY CASE alpha_access_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                     created_at DESC
            LIMIT 1000`
        );
        const now = Date.now();
        const mapped = result.rows.map(row => {
          const complimentaryPlan = ["SLOTH_PLUS", "SLOTH_PRO"].includes(String(row.alpha_plan_override || "").toUpperCase())
            ? String(row.alpha_plan_override).toUpperCase()
            : null;
          const complimentaryExpiresAt = row.alpha_plan_override_expires_at ? Number(row.alpha_plan_override_expires_at) : null;
          return {
            id: row.id,
            displayName: row.display_name,
            handle: row.handle,
            email: row.email,
            emailVerified: !!row.email_verified_at,
            status: row.alpha_access_status || "approved",
            billingPlan: normalizedPlan(row.plan),
            effectivePlan: effectivePlan(row),
            complimentaryPlan,
            complimentaryActive: !!complimentaryPlan && (!complimentaryExpiresAt || complimentaryExpiresAt > now),
            complimentaryExpiresAt,
            complimentaryNote: row.alpha_plan_override_note || "",
            complimentaryUpdatedAt: row.alpha_plan_override_updated_at ? Number(row.alpha_plan_override_updated_at) : null,
            founding50Position: row.founding_50_position ? Number(row.founding_50_position) : null,
            founding50ClaimedAt: row.founding_50_claimed_at ? Number(row.founding_50_claimed_at) : null,
            founding50ExpiresAt: row.founding_50_expires_at ? Number(row.founding_50_expires_at) : null,
            founding50MomentKey: row.founding_50_moment_key || "",
            founding50PovCount: Number(row.founding_50_pov_count || 0),
            founding50Active: activeFounding50Reward(row, now),
            grantedAt: row.alpha_access_granted_at ? Number(row.alpha_access_granted_at) : null,
            reviewedAt: row.alpha_reviewed_at ? Number(row.alpha_reviewed_at) : null,
            createdAt: Number(row.created_at)
          };
        });
        return json(res, 200, {
          ok: true,
          version: SERVER_VERSION,
          summary,
          founding50,
          pendingAccounts: mapped.filter(item => item.status === "pending"),
          approvedTesters: mapped.filter(item => item.status === "approved"),
          rejectedAccounts: mapped.filter(item => item.status === "rejected"),
          creatorGrants: mapped.filter(item => !!item.complimentaryPlan)
            .sort((a, b) => Number(b.complimentaryActive) - Number(a.complimentaryActive) || Number(b.complimentaryUpdatedAt || 0) - Number(a.complimentaryUpdatedAt || 0))
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/settings") {
        const body = await readBody(req);
        const approvalRequired = body.approvalRequired !== false;
        const testerLimit = Math.max(1, Math.min(10000, Number(body.testerLimit) || ALPHA_TESTER_LIMIT_DEFAULT));
        const now = Date.now();
        const approvedPending = await withTransaction(async client => {
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [ALPHA_ADVISORY_LOCK]);
          await client.query(
            `INSERT INTO alpha_settings (id, invite_required, tester_limit, updated_at)
             VALUES (1, $1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET
               invite_required = EXCLUDED.invite_required,
               tester_limit = EXCLUDED.tester_limit,
               updated_at = EXCLUDED.updated_at`,
            [approvalRequired, testerLimit, now]
          );
          if (approvalRequired) return 0;
          const pending = await client.query(
            `UPDATE users
                SET alpha_access_status = 'approved',
                    alpha_access_granted_at = COALESCE(alpha_access_granted_at, $1),
                    alpha_reviewed_at = $1,
                    updated_at = $1
              WHERE alpha_access_status = 'pending'
              RETURNING id`,
            [now]
          );
          return pending.rowCount;
        });
        const summary = await alphaAccessSummary();
        return json(res, 200, {
          ok: true,
          summary,
          message: approvalRequired
            ? "Closed Alpha approval mode saved."
            : `Open Beta is active. ${approvedPending} pending account(s) were approved automatically.`
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/founding-50/settings") {
        const body = await readBody(req);
        if (typeof body.enabled !== "boolean") {
          return json(res, 400, { ok: false, message: "enabled must be true or false." });
        }
        const now = Date.now();
        await withTransaction(async client => {
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [FOUNDING_50_ADVISORY_LOCK]);
          const current = await alphaSettings(client);
          await client.query(
            `INSERT INTO alpha_settings (id, invite_required, tester_limit, founding_50_enabled, updated_at)
             VALUES (1, $1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               founding_50_enabled = EXCLUDED.founding_50_enabled,
               updated_at = EXCLUDED.updated_at`,
            [current.inviteRequired, current.testerLimit, body.enabled, now]
          );
        });
        const founding50 = await founding50Summary();
        return json(res, 200, {
          ok: true,
          founding50,
          message: founding50.finished
            ? "Founding 50 is already full."
            : body.enabled ? "Founding 50 is active." : "Founding 50 has been paused."
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/creator-access/grant") {
        const body = await readBody(req);
        const handle = normalizeHandle(body.handle).slice(0, 64);
        const plan = String(body.plan || "SLOTH_PRO").toUpperCase();
        const durationDaysRaw = Number(body.durationDays);
        const durationDays = Number.isFinite(durationDaysRaw) ? Math.max(0, Math.min(3650, Math.floor(durationDaysRaw))) : 90;
        const note = String(body.note || "").replace(/\0/g, "").trim().slice(0, 240);
        const approveAccount = body.approveAccount !== false;
        if (!handle) return json(res, 400, { ok: false, message: "Enter a GameSloth handle." });
        if (!["SLOTH_PLUS", "SLOTH_PRO"].includes(plan)) {
          return json(res, 400, { ok: false, message: "Choose Sloth+ or Sloth Pro." });
        }
        const now = Date.now();
        const expiresAt = durationDays > 0 ? now + durationDays * 24 * 60 * 60 * 1000 : null;
        const account = await withTransaction(async client => {
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [ALPHA_ADVISORY_LOCK]);
          const found = await client.query(`SELECT * FROM users WHERE lower(handle) = $1 LIMIT 1 FOR UPDATE`, [handle]);
          const current = found.rows[0];
          if (!current) throw Object.assign(new Error(`@${handle} does not have a GameSloth account yet. Ask them to create one first.`), { statusCode: 404 });

          if (approveAccount && current.alpha_access_status !== "approved") {
            const summary = await alphaAccessSummary(client);
            if (summary.approvalRequired && summary.spotsRemaining <= 0) {
              throw Object.assign(new Error("The approved tester limit has been reached. Raise the tester limit first, or untick automatic approval."), { statusCode: 409 });
            }
          }

          const updated = await client.query(
            `UPDATE users
                SET alpha_plan_override = $1,
                    alpha_plan_override_expires_at = $2,
                    alpha_plan_override_note = $3,
                    alpha_plan_override_updated_at = $4,
                    alpha_access_status = CASE WHEN $5 THEN 'approved' ELSE alpha_access_status END,
                    alpha_access_granted_at = CASE WHEN $5 THEN COALESCE(alpha_access_granted_at, $4) ELSE alpha_access_granted_at END,
                    alpha_reviewed_at = CASE WHEN $5 THEN $4 ELSE alpha_reviewed_at END,
                    updated_at = $4
              WHERE id = $6
              RETURNING *`,
            [plan, expiresAt, note || null, now, approveAccount, current.id]
          );
          return updated.rows[0];
        });
        const expiryLabel = expiresAt ? ` until ${new Date(expiresAt).toISOString().slice(0, 10)}` : " until you revoke it";
        return json(res, 200, {
          ok: true,
          user: accountUser(account),
          complimentaryPlan: plan,
          expiresAt,
          message: `@${account.handle} now has complimentary ${planDisplayName(plan)}${expiryLabel}.${approveAccount ? " Closed Alpha access is approved too." : ""}`
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/creator-access/revoke") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().slice(0, 64);
        const handle = normalizeHandle(body.handle).slice(0, 64);
        if (!id && !handle) return json(res, 400, { ok: false, message: "Choose an account to revoke." });
        const now = Date.now();
        const result = id
          ? await query(
            `UPDATE users
                  SET alpha_plan_override = NULL,
                      alpha_plan_override_expires_at = NULL,
                      alpha_plan_override_note = NULL,
                      alpha_plan_override_updated_at = $1,
                      updated_at = $1
                WHERE id = $2
                RETURNING *`,
            [now, id]
          )
          : await query(
            `UPDATE users
                  SET alpha_plan_override = NULL,
                      alpha_plan_override_expires_at = NULL,
                      alpha_plan_override_note = NULL,
                      alpha_plan_override_updated_at = $1,
                      updated_at = $1
                WHERE lower(handle) = $2
                RETURNING *`,
            [now, handle]
          );
        const account = result.rows[0];
        if (!account) return json(res, 404, { ok: false, message: "Account not found." });
        return json(res, 200, {
          ok: true,
          user: accountUser(account),
          message: `Complimentary plan revoked for @${account.handle}. Their normal ${planDisplayName(normalizedPlan(account.plan))} plan remains unchanged.`
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/accounts/status") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().slice(0, 64);
        const requestedStatus = String(body.status || "").toLowerCase();
        if (!id || !["approved", "rejected"].includes(requestedStatus)) {
          return json(res, 400, { ok: false, message: "Choose a valid account and status." });
        }
        const now = Date.now();
        const result = await withTransaction(async client => {
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [ALPHA_ADVISORY_LOCK]);
          const userResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`, [id]);
          const account = userResult.rows[0];
          if (!account) throw Object.assign(new Error("Account not found."), { statusCode: 404 });
          const summary = await alphaAccessSummary(client);
          if (requestedStatus === "approved" && summary.approvalRequired && account.alpha_access_status !== "approved" && summary.spotsRemaining <= 0) {
            throw Object.assign(new Error("The approved tester limit has been reached. Raise the limit or revoke another tester first."), { statusCode: 409 });
          }
          const updated = await client.query(
            `UPDATE users
                SET alpha_access_status = $1,
                    alpha_access_granted_at = CASE WHEN $1 = 'approved' THEN COALESCE(alpha_access_granted_at, $2) ELSE NULL END,
                    alpha_reviewed_at = $2,
                    updated_at = $2
              WHERE id = $3
              RETURNING *`,
            [requestedStatus, now, id]
          );
          if (requestedStatus !== "approved") {
            await client.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
          }
          return updated.rows[0];
        });
        return json(res, 200, {
          ok: true,
          user: accountUser(result),
          message: requestedStatus === "approved"
            ? `@${result.handle} can now sign in to GameSloth.`
            : `@${result.handle} is blocked from the Closed Alpha.`
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/accounts/password-reset-link") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().slice(0, 64);
        const result = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
        const account = result.rows[0];
        if (!account) return json(res, 404, { ok: false, message: "Account not found." });
        const reset = await createPasswordResetForUser(account, { sendEmail: false });
        return json(res, 200, { ok: true, url: reset.link, expiresAt: reset.expiresAt });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/accounts/verification-link") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().slice(0, 64);
        const result = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
        const account = result.rows[0];
        if (!account) return json(res, 404, { ok: false, message: "Account not found." });
        if (account.email_verified_at) return json(res, 200, { ok: true, alreadyVerified: true, message: "This email is already verified." });
        const verification = await createEmailVerificationForUser(account, { sendEmail: false });
        return json(res, 200, { ok: true, url: verification.link, expiresAt: verification.expiresAt });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/alpha/accounts/mark-email-verified") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().slice(0, 64);
        const now = Date.now();
        const result = await query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $1 WHERE id = $2 RETURNING *`, [now, id]);
        if (!result.rows[0]) return json(res, 404, { ok: false, message: "Account not found." });
        await query(`UPDATE email_verification_tokens SET used_at = COALESCE(used_at, $1) WHERE user_id = $2 AND used_at IS NULL`, [now, id]);
        return json(res, 200, { ok: true, message: `Email for @${result.rows[0].handle} marked as verified.` });
      }

      return json(res, 404, { ok: false, message: "Alpha Admin endpoint not found." });
    }

    if (req.method === "GET" && url.pathname === "/feedback/admin") {
      return html(res, 200, feedbackAdminPage());
    }

    if (url.pathname.startsWith("/api/admin/feedback/")) {
      if (!hasFeedbackAdminAccess(req)) {
        return json(res, 401, { ok: false, message: "Invalid feedback admin token." });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/feedback/submissions") {
        const allowedStatuses = ["new", "reviewing", "planned", "fixed", "closed"];
        const allowedCategories = ["bug", "suggestion", "usability", "performance", "account", "sync", "billing", "ads", "other"];
        const requestedStatus = String(url.searchParams.get("status") || "all").toLowerCase();
        const requestedCategory = String(url.searchParams.get("category") || "all").toLowerCase();
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
        const where = [];
        const values = [];
        if (allowedStatuses.includes(requestedStatus)) {
          values.push(requestedStatus);
          where.push(`status = $${values.length}`);
        }
        if (allowedCategories.includes(requestedCategory)) {
          values.push(requestedCategory);
          where.push(`category = $${values.length}`);
        }
        values.push(limit);
        const result = await query(
          `SELECT * FROM alpha_feedback ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY created_at DESC
            LIMIT $${values.length}`,
          values
        );
        const countResult = await query(`SELECT status, COUNT(*)::int AS count FROM alpha_feedback GROUP BY status`);
        const totalResult = await query(`SELECT COUNT(*)::int AS count FROM alpha_feedback`);
        const counts = Object.fromEntries(countResult.rows.map(row => [row.status, Number(row.count || 0)]));
        return json(res, 200, {
          ok: true,
          version: SERVER_VERSION,
          total: Number(totalResult.rows[0]?.count || 0),
          counts,
          submissions: result.rows.map(row => ({
            id: row.id,
            testerName: row.tester_name || "",
            email: row.email || "",
            handle: row.handle || "",
            appVersion: row.app_version || "",
            category: row.category,
            severity: row.severity,
            area: row.area,
            title: row.title,
            description: row.description,
            steps: row.steps || "",
            expected: row.expected || "",
            actual: row.actual || "",
            deviceInfo: row.device_info || "",
            screenshotUrl: row.screenshot_url || "",
            source: row.source,
            contactAllowed: !!row.contact_allowed,
            status: row.status,
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at)
          }))
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/feedback/status") {
        const body = await readBody(req);
        const id = cleanFeedbackText(body.id, 64);
        const status = cleanFeedbackChoice(body.status, ["new", "reviewing", "planned", "fixed", "closed"], null);
        if (!id || !status) return json(res, 400, { ok: false, message: "Valid feedback ID and status are required." });
        const result = await query(
          `UPDATE alpha_feedback SET status = $1, updated_at = $2 WHERE id = $3 RETURNING id, status`,
          [status, Date.now(), id]
        );
        if (!result.rowCount) return json(res, 404, { ok: false, message: "Feedback report not found." });
        return json(res, 200, { ok: true, id: result.rows[0].id, status: result.rows[0].status });
      }
    }

    if (req.method === "GET" && url.pathname === "/ads/admin") {
      return html(res, 200, adsAdminPage());
    }

    if (url.pathname.startsWith("/api/admin/ads/")) {
      if (!hasAdsAdminAccess(req)) {
        return json(res, 401, { ok: false, message: "Invalid ads admin token." });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ads/ping") {
        return json(res, 200, { ok: true, version: SERVER_VERSION });
      }

      if (req.method === "GET" && url.pathname === "/api/admin/ads/campaigns") {
        const result = await query(
          `SELECT c.*,
                  COUNT(e.id) FILTER (WHERE e.event_type = 'impression')::int AS impressions,
                  COUNT(e.id) FILTER (WHERE e.event_type = 'click')::int AS clicks
             FROM ad_campaigns c
             LEFT JOIN ad_events e ON e.campaign_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC`
        );
        return json(res, 200, {
          ok: true,
          campaigns: result.rows.map(row => ({
            id: row.id,
            sponsor: row.sponsor || "",
            label: row.label,
            headline: row.headline,
            description: row.description,
            buttonLabel: row.button_label,
            actionType: row.action_type,
            actionValue: row.action_value || "",
            logoUrl: row.logo_url || "",
            bannerUrl: row.banner_url || "",
            brandColor: row.brand_color || "#73BD82",
            placements: row.placements || [],
            weight: Number(row.weight || 1),
            frequencyCapHours: Number(row.frequency_cap_hours || 12),
            active: !!row.active,
            impressions: Number(row.impressions || 0),
            clicks: Number(row.clicks || 0),
            ctr: Number(row.impressions || 0) ? Number((Number(row.clicks || 0) / Number(row.impressions) * 100).toFixed(2)) : 0
          }))
        });
      }

      if (req.method === "POST" && url.pathname === "/api/admin/ads/campaigns") {
        const body = await readBody(req);
        const id = String(body.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
        const headline = String(body.headline || "").trim().slice(0, 100);
        const description = String(body.description || "").trim().slice(0, 240);
        const actionType = body.actionType === "plans" ? "plans" : "external";
        const actionValue = String(body.actionValue || "").trim().slice(0, 500);
        const logoUrl = String(body.logoUrl || "").trim().slice(0, 800);
        const bannerUrl = String(body.bannerUrl || "").trim().slice(0, 800);
        const brandColorInput = String(body.brandColor || "").trim().toUpperCase();
        const brandColor = /^#[0-9A-F]{6}$/.test(brandColorInput) ? brandColorInput : "#73BD82";
        const placements = [...new Set((Array.isArray(body.placements) ? body.placements : []).map(cleanAdPlacement).filter(Boolean))];
        if (!id || !headline || !description || !placements.length) {
          return json(res, 400, { ok: false, message: "ID, headline, description and at least one placement are required." });
        }
        if (actionType === "external" && !/^https:\/\//i.test(actionValue)) {
          return json(res, 400, { ok: false, message: "External campaigns require an HTTPS target URL." });
        }
        if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
          return json(res, 400, { ok: false, message: "Logo URL must use HTTPS." });
        }
        if (bannerUrl && !/^https:\/\//i.test(bannerUrl)) {
          return json(res, 400, { ok: false, message: "Banner URL must use HTTPS." });
        }
        const now = Date.now();
        await query(
          `INSERT INTO ad_campaigns
             (id, sponsor, label, headline, description, button_label, action_type, action_value, logo_url, banner_url, brand_color, placements, weight, frequency_cap_hours, active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
           ON CONFLICT (id) DO UPDATE SET
             sponsor = EXCLUDED.sponsor,
             label = EXCLUDED.label,
             headline = EXCLUDED.headline,
             description = EXCLUDED.description,
             button_label = EXCLUDED.button_label,
             action_type = EXCLUDED.action_type,
             action_value = EXCLUDED.action_value,
             logo_url = EXCLUDED.logo_url,
             banner_url = EXCLUDED.banner_url,
             brand_color = EXCLUDED.brand_color,
             placements = EXCLUDED.placements,
             weight = EXCLUDED.weight,
             frequency_cap_hours = EXCLUDED.frequency_cap_hours,
             active = EXCLUDED.active,
             updated_at = EXCLUDED.updated_at`,
          [
            id,
            String(body.sponsor || "").trim().slice(0, 80) || null,
            String(body.label || "Sponsored").trim().slice(0, 30) || "Sponsored",
            headline,
            description,
            String(body.buttonLabel || "View offer").trim().slice(0, 40) || "View offer",
            actionType,
            actionType === "external" ? actionValue : null,
            logoUrl || null,
            bannerUrl || null,
            brandColor,
            placements,
            Math.max(1, Math.min(100, Number(body.weight) || 10)),
            Math.max(1, Math.min(720, Number(body.frequencyCapHours) || 12)),
            body.active !== false,
            now
          ]
        );
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/admin/backup/export") {
      if (!hasBackupAdminAccess(req)) return json(res, 401, { ok: false, message: "Invalid backup admin token." });
      return json(res, 200, await databaseSnapshot());
    }

    if (req.method === "GET" && url.pathname === "/") {
      return json(res, 200, {
        ok: true,
        service: "GameSloth",
        version: SERVER_VERSION
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
      await query("SELECT 1");
      const alphaSummary = await alphaAccessSummary();
      return json(res, 200, {
        ok: true,
        service: "GameSloth",
        version: SERVER_VERSION,
        database: "connected",
        websocketClients: wss.clients.size,
        onlineRooms: rooms.size,
        stripeConfigured: !!stripe,
        adsAdminConfigured: !!ADS_ADMIN_TOKEN,
        feedbackAdminConfigured: !!FEEDBACK_ADMIN_TOKEN,
        alphaAdminConfigured: !!ALPHA_ADMIN_TOKEN,
        backupAdminConfigured: !!BACKUP_ADMIN_TOKEN,
        adminTokensDistinct: new Set([ADS_ADMIN_TOKEN, FEEDBACK_ADMIN_TOKEN, ALPHA_ADMIN_TOKEN, BACKUP_ADMIN_TOKEN].filter(Boolean)).size === 4,
        sharedAdminTokenAllowed: ALLOW_SHARED_ADMIN_TOKEN,
        transactionalEmailConfigured: transactionalEmailConfigured(),
        emailVerificationRequired: EMAIL_VERIFICATION_REQUIRED,
        corsAllowedOrigins: Array.from(CORS_ALLOWED_ORIGINS),
        alphaApprovalRequired: alphaSummary.approvalRequired,
        alphaPhase: alphaSummary.phase,
        alphaTesterLimit: alphaSummary.testerLimit,
        alphaTesterCount: alphaSummary.testerCount,
        alphaPendingAccounts: alphaSummary.pendingCount
      });
    }

    if (req.method === "GET" && url.pathname === "/api/client-config") {
      const alphaSummary = await alphaAccessSummary();
      return json(res, 200, {
        ok: true,
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
        updates: {
          enabled: !!UPDATE_BASE_URL,
          baseUrl: UPDATE_BASE_URL || null,
          channel: "latest"
        },
        alpha: {
          approvalRequired: alphaSummary.approvalRequired,
          inviteRequired: false,
          phase: alphaSummary.phase,
          testerLimit: alphaSummary.testerLimit,
          testerCount: alphaSummary.testerCount,
          pendingCount: alphaSummary.pendingCount,
          spotsRemaining: alphaSummary.approvalRequired ? alphaSummary.spotsRemaining : null,
          downloadUrl: `${PUBLIC_BASE_URL}/download/windows`
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/feedback") {
      const body = await readBody(req);

      // Hidden honeypot field. Bots receive a generic success without storing data.
      if (cleanFeedbackText(body.website, 200)) {
        return json(res, 201, { ok: true, referenceId: "received" });
      }

      if (!consumeFeedbackRate(req)) {
        return json(res, 429, { ok: false, message: "Too many feedback submissions. Try again later." });
      }

      const testerName = cleanFeedbackText(body.testerName, 80);
      const email = cleanFeedbackText(body.email, 160).toLowerCase();
      const handle = normalizeHandle(cleanFeedbackText(body.handle, 40));
      const appVersion = cleanFeedbackText(body.appVersion, 32);
      const category = cleanFeedbackChoice(body.category, ["bug", "suggestion", "usability", "performance", "account", "sync", "billing", "ads", "other"], "other");
      const severity = cleanFeedbackChoice(body.severity, ["low", "medium", "high", "blocker"], "medium");
      const area = cleanFeedbackChoice(body.area, ["installation", "account", "recording", "clips", "moments", "social", "sync", "plans", "ads", "updater", "other"], "other");
      const title = cleanFeedbackText(body.title, 120);
      const description = cleanFeedbackText(body.description, 4000);
      const steps = cleanFeedbackText(body.steps, 4000);
      const expected = cleanFeedbackText(body.expected, 2000);
      const actual = cleanFeedbackText(body.actual, 2000);
      const deviceInfo = cleanFeedbackText(body.deviceInfo, 1200);
      const screenshotUrl = cleanFeedbackText(body.screenshotUrl, 800);
      const source = cleanFeedbackChoice(body.source, ["website", "desktop"], "website");
      const contactAllowed = body.contactAllowed === true;

      if (title.length < 4 || description.length < 10) {
        return json(res, 400, { ok: false, message: "Add a short title and describe what happened." });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(res, 400, { ok: false, message: "Enter a valid email address or leave it blank." });
      }
      if (screenshotUrl && !/^https:\/\//i.test(screenshotUrl)) {
        return json(res, 400, { ok: false, message: "Screenshot links must start with https://" });
      }

      const id = createId("fb");
      const now = Date.now();
      await query(
        `INSERT INTO alpha_feedback
          (id, tester_name, email, handle, app_version, category, severity, area, title, description, steps, expected, actual, device_info, screenshot_url, source, contact_allowed, status, visitor_key, user_agent, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'new',$18,$19,$20,$20)`,
        [
          id,
          testerName || null,
          email || null,
          handle || null,
          appVersion || null,
          category,
          severity,
          area,
          title,
          description,
          steps || null,
          expected || null,
          actual || null,
          deviceInfo || null,
          screenshotUrl || null,
          source,
          contactAllowed,
          feedbackVisitorKey(req),
          cleanFeedbackText(req.headers["user-agent"], 500) || null,
          now
        ]
      );

      return json(res, 201, {
        ok: true,
        referenceId: id,
        message: "Thanks. Your Closed Alpha feedback was received."
      });
    }


    if (req.method === "POST" && url.pathname === "/api/auth/forgot-password") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!consumeRecoveryRate(req, email)) return json(res, 429, { ok: false, message: "Too many recovery requests. Try again later." });
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const result = await query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
        if (result.rows[0]) {
          try { await createPasswordResetForUser(result.rows[0], { sendEmail: true }); }
          catch (error) { console.error("[email] password reset delivery failed", error.message); }
        }
      }
      return json(res, 200, { ok: true, message: "If that email belongs to a GameSloth account, a reset link has been sent." });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/reset-password") {
      const body = await readBody(req);
      const rawToken = String(body.token || "").trim();
      const newPassword = String(body.password || "");
      if (newPassword.length < 8) return json(res, 400, { ok: false, message: "Use a password of at least 8 characters." });
      if (!consumeRecoveryRate(req, rawToken.slice(0, 16))) return json(res, 429, { ok: false, message: "Too many reset attempts. Try again later." });
      const tokenHash = hashToken(rawToken);
      const now = Date.now();
      const account = await withTransaction(async client => {
        const tokenResult = await client.query(`SELECT t.user_id FROM password_reset_tokens t WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > $2 LIMIT 1 FOR UPDATE`, [tokenHash, now]);
        const tokenRow = tokenResult.rows[0];
        if (!tokenRow) return null;
        const salt = crypto.randomBytes(16).toString("hex");
        const passwordHash = await hashPasswordAsync(newPassword, salt);
        const result = await client.query(`UPDATE users SET salt = $1, password_hash = $2, updated_at = $3 WHERE id = $4 RETURNING *`, [salt, passwordHash, now, tokenRow.user_id]);
        await client.query(`UPDATE password_reset_tokens SET used_at = $1 WHERE token_hash = $2`, [now, tokenHash]);
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [tokenRow.user_id]);
        return result.rows[0] || null;
      });
      if (!account) return json(res, 400, { ok: false, message: "This reset link is invalid, expired or already used." });
      return json(res, 200, { ok: true, message: "Your password has been changed. You can now sign in to GameSloth." });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify-email") {
      const body = await readBody(req);
      const rawToken = String(body.token || "").trim();
      if (!consumeRecoveryRate(req, rawToken.slice(0, 16))) return json(res, 429, { ok: false, message: "Too many verification attempts. Try again later." });
      const tokenHash = hashToken(rawToken);
      const now = Date.now();
      const account = await withTransaction(async client => {
        const tokenResult = await client.query(`SELECT user_id FROM email_verification_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 LIMIT 1 FOR UPDATE`, [tokenHash, now]);
        const tokenRow = tokenResult.rows[0];
        if (!tokenRow) return null;
        const result = await client.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $1 WHERE id = $2 RETURNING *`, [now, tokenRow.user_id]);
        await client.query(`UPDATE email_verification_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL`, [now, tokenRow.user_id]);
        return result.rows[0] || null;
      });
      if (!account) return json(res, 400, { ok: false, message: "This verification link is invalid, expired or already used." });
      return json(res, 200, { ok: true, message: "Your GameSloth email is verified." });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/resend-verification") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!consumeRecoveryRate(req, email)) return json(res, 429, { ok: false, message: "Too many verification requests. Try again later." });
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const result = await query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
        if (result.rows[0] && !result.rows[0].email_verified_at) {
          try { await createEmailVerificationForUser(result.rows[0], { sendEmail: true }); }
          catch (error) { console.error("[email] verification delivery failed", error.message); }
        }
      }
      return json(res, 200, { ok: true, message: "If that email is unverified, a new verification link has been sent." });
    }

    if (req.method === "POST" && url.pathname === "/api/register") {
      const registerRate = consumeRegisterRate(req);
      if (!registerRate.allowed) {
        return json(res, 429, {
          ok: false,
          code: "REGISTER_RATE_LIMITED",
          retryAfterSeconds: registerRate.retryAfterSeconds,
          message: `Too many account creation attempts. Try again in ${Math.ceil(registerRate.retryAfterSeconds / 60)} minute(s).`
        });
      }
      const body = await readBody(req);
      const legacyInviteClient = Object.prototype.hasOwnProperty.call(body, "inviteCode");
      const email = String(body.email || "").trim().toLowerCase();
      const handle = normalizeHandle(body.handle);
      const displayName = String(body.displayName || "").trim().slice(0, 32);
      const password = String(body.password || "");

      if (!email.includes("@") || handle.length < 3 || displayName.length < 2 || password.length < 8) {
        return json(res, 400, { ok: false, message: "Enter a valid email, username, display name and a password of at least 8 characters." });
      }
      if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
        return json(res, 400, { ok: false, message: "Username can only use letters, numbers and underscores." });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const userId = createId("usr");
      const now = Date.now();
      const passwordHash = await hashPasswordAsync(password, salt);
      let user;
      let approvalRequired = true;
      try {
        user = await withTransaction(async client => {
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [ALPHA_ADVISORY_LOCK]);
          const summary = await alphaAccessSummary(client);
          approvalRequired = summary.approvalRequired;
          const status = approvalRequired ? "pending" : "approved";
          const grantedAt = approvalRequired ? null : now;
          const insertResult = await client.query(
            `INSERT INTO users
              (id, email, handle, display_name, plan, salt, password_hash, created_at,
               alpha_access_status, alpha_access_granted_at, alpha_reviewed_at, alpha_invite_id)
             VALUES ($1, $2, $3, $4, 'FREE', $5, $6, $7, $8, $9, $10, NULL)
             RETURNING *`,
            [userId, email, handle, displayName, salt, passwordHash, now, status, grantedAt, grantedAt]
          );
          return insertResult.rows[0];
        });
      } catch (err) {
        if (err && err.code === "23505") {
          const field = String(err.constraint || "").includes("email") ? "email" : "username";
          return json(res, 409, { ok: false, code: "ACCOUNT_EXISTS", message: `That ${field} is already registered. Try signing in instead.` });
        }
        throw err;
      }

      let emailVerificationSent = false;
      try {
        const verification = await createEmailVerificationForUser(user, { sendEmail: true });
        emailVerificationSent = !!verification.delivery?.sent;
      } catch (error) {
        console.error("[email] registration verification delivery failed", error.message);
      }

      if (approvalRequired) {
        const pendingPayload = {
          ok: !legacyInviteClient,
          accountCreated: true,
          approvalStatus: "pending",
          emailVerificationSent,
          user: accountUser(user),
          message: "Your account was created. Closed Alpha access is waiting for approval. Try signing in again after GameSloth approves your account."
        };
        return json(res, 202, pendingPayload);
      }

      if (EMAIL_VERIFICATION_REQUIRED && !user.email_verified_at) {
        return json(res, 202, { ok: true, accountCreated: true, approvalStatus: "approved", verificationRequired: true, emailVerificationSent, user: accountUser(user), message: "Your account was created. Verify your email before signing in." });
      }

      const sessionToken = await issueSession(user.id);
      return json(res, 201, { ok: true, accountCreated: true, approvalStatus: "approved", token: sessionToken, user: accountUser(user) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const loginRate = consumeLoginRate(req);
      if (!loginRate.allowed) {
        return json(res, 429, {
          ok: false,
          code: "LOGIN_RATE_LIMITED",
          retryAfterSeconds: loginRate.retryAfterSeconds,
          message: `Too many sign-in attempts. Try again in ${Math.ceil(loginRate.retryAfterSeconds / 60)} minute(s).`
        });
      }
      const body = await readBody(req);
      const login = String(body.login || "").trim().toLowerCase();
      const password = String(body.password || "");

      const result = await query(
        `SELECT *
           FROM users
          WHERE email = $1 OR handle = $2
          LIMIT 1`,
        [login, normalizeHandle(login)]
      );

      const user = result.rows[0];

      const salt = user?.salt || "00000000000000000000000000000000";
      const candidateHash = await hashPasswordAsync(password, salt);
      const valid = !!user && timingSafeHexEqual(candidateHash, user.password_hash);

      if (!valid) {
        return json(res, 401, { ok: false, message: "Incorrect email/username or password." });
      }

      const currentSettings = await alphaSettings();
      let accessStatus = String(user.alpha_access_status || "approved");
      if (!currentSettings.inviteRequired && accessStatus === "pending") {
        const promoted = await query(
          `UPDATE users
              SET alpha_access_status = 'approved',
                  alpha_access_granted_at = COALESCE(alpha_access_granted_at, $1),
                  alpha_reviewed_at = $1,
                  updated_at = $1
            WHERE id = $2
            RETURNING *`,
          [Date.now(), user.id]
        );
        Object.assign(user, promoted.rows[0] || {});
        accessStatus = "approved";
      }
      if (accessStatus === "pending") {
        return json(res, 403, {
          ok: false,
          code: "ALPHA_APPROVAL_PENDING",
          accountExists: true,
          approvalStatus: "pending",
          message: "Your account exists and is waiting for Closed Alpha approval. Try again after GameSloth approves it."
        });
      }
      if (accessStatus === "rejected") {
        return json(res, 403, {
          ok: false,
          code: "ALPHA_ACCESS_REJECTED",
          accountExists: true,
          approvalStatus: "rejected",
          message: "This account does not currently have Closed Alpha access."
        });
      }

      if (EMAIL_VERIFICATION_REQUIRED && !user.email_verified_at) {
        return json(res, 403, { ok: false, code: "EMAIL_VERIFICATION_REQUIRED", accountExists: true, message: "Verify your email address before signing in." });
      }

      const deviceName = String(body.deviceName || "another device").trim().slice(0, 50);
      await query(
        `UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2`,
        [Date.now(), user.id]
      );
      const sessionToken = await issueSession(user.id, deviceName);
      return json(res, 200, {
        ok: true,
        token: sessionToken,
        user: accountUser(user)
      });
    }

    const user = await authenticatedUser(req);


    if (req.method === "GET" && url.pathname === "/api/ads/next") {
      const placement = cleanAdPlacement(url.searchParams.get("placement"));
      if (!placement) return json(res, 400, { ok: false, message: "Invalid ad placement." });
      if (user && !entitlementsForUser(user).adsEnabled) {
        return json(res, 200, { ok: true, ad: null, reason: "ad_free_plan" });
      }
      const visitorKey = adVisitorKey(req, user);
      const campaign = await nextAdCampaign({ placement, visitorKey });
      return json(res, 200, { ok: true, ad: publicCampaign(campaign) });
    }

    if (req.method === "POST" && url.pathname === "/api/ads/event") {
      const body = await readBody(req);
      const placement = cleanAdPlacement(body.placement);
      const campaignId = String(body.campaignId || "").trim().slice(0, 64);
      const eventType = String(body.eventType || "").toLowerCase();
      if (!placement || !campaignId || !["impression", "click"].includes(eventType)) {
        return json(res, 400, { ok: false, message: "Invalid ad event." });
      }
      if (user && !entitlementsForUser(user).adsEnabled) return json(res, 200, { ok: true });
      await recordAdEvent({
        campaignId,
        placement,
        eventType,
        visitorKey: adVisitorKey(req, user),
        userId: user?.id || null
      });
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/api/") && !user) {
      const authHeader = String(req.headers.authorization || "");
      if (authHeader.startsWith("Bearer ")) {
        const rawToken = authHeader.slice(7).trim();
        const th = hashToken(rawToken);
        if (revokedSessionTokens.has(th)) {
          const rev = revokedSessionTokens.get(th);
          const devText = rev.deviceName && rev.deviceName !== "another device" ? ` (${rev.deviceName})` : "";
          return json(res, 401, {
            ok: false,
            code: rev.reason || "CONCURRENT_LOGIN",
            deviceName: rev.deviceName,
            message: `Your account was signed in on another device${devText}. You have been logged out.`
          });
        }
      }
      return json(res, 401, {
        ok: false,
        message: "Please sign in again."
      });
    }

    if (url.pathname === "/api/leaderboard/me") {
      if (req.method === "GET") {
        return json(res, 200, { ok: true, leaderboard: await leaderboard.preferences(user.id) });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (typeof body.enabled !== "boolean") {
          return json(res, 400, { ok: false, message: "enabled must be true or false." });
        }
        if (body.enabled && !leaderboard.enabled) {
          return json(res, 503, { ok: false, message: "The community leaderboard is not available yet." });
        }
        return json(res, 200, {
          ok: true,
          leaderboard: await leaderboard.setParticipation(user.id, body.enabled)
        });
      }
      return json(res, 405, { ok: false, message: "Use GET or POST." });
    }

    if (req.method === "GET" && url.pathname === "/api/moments/quota") {
      return json(res, 200, {
        ok: true,
        quota: await momentSaveQuotaForUser(user)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/moments/reserve") {
      const body = await readBody(req);
      const reservation = await reserveMultiPovMomentSave(user, {
        momentKey: body.momentKey,
        source: body.source,
        povCount: body.povCount
      });

      if (!reservation.allowed) {
        return json(res, 403, {
          ok: false,
          code: reservation.code || "MONTHLY_MULTI_POV_LIMIT",
          message: reservation.message || "Monthly multi-POV save allowance reached.",
          quota: reservation.quota
        });
      }

      return json(res, 200, {
        ok: true,
        reservation: { counted: reservation.counted, existing: reservation.existing },
        quota: reservation.quota
      });
    }

    if (req.method === "GET" && url.pathname === "/api/entitlements") {
      return json(res, 200, {
        ok: true,
        entitlements: entitlementsForUser(user),
        momentSaveQuota: await momentSaveQuotaForUser(user),
        founding50: Number(user.founding_50_position || 0) > 0 ? {
          winner: true,
          position: Number(user.founding_50_position),
          claimedAt: Number(user.founding_50_claimed_at || 0),
          expiresAt: Number(user.founding_50_expires_at || 0),
          active: activeFounding50Reward(user)
        } : { winner: false },
        billing: {
          configured: !!stripe && !!PRICE_IDS.SLOTH_PLUS.monthly && !!PRICE_IDS.SLOTH_PLUS.annual && !!PRICE_IDS.SLOTH_PRO.monthly && !!PRICE_IDS.SLOTH_PRO.annual,
          subscriptionStatus: user.subscription_status || null,
          hasCustomer: !!user.stripe_customer_id
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/entitlements/authorize") {
      const body = await readBody(req);
      const feature = String(body.feature || "");
      const entitlements = entitlementsForUser(user);
      const allowed = !!entitlements.features[feature];

      if (!allowed) {
        const proFeatures = new Set(["slothDirector", "advancedAudio", "batchPovExport", "cinematicCuts", "povTiming"]);
        const requiredPlan = proFeatures.has(feature) ? "SLOTH_PRO" : "SLOTH_PLUS";
        const label = requiredPlan === "SLOTH_PRO" ? "Sloth Pro" : "Sloth+";
        return json(res, 403, {
          ok: false,
          allowed: false,
          requiredPlan,
          plan: entitlements.plan,
          message: `${label} is required for this feature.`
        });
      }

      return json(res, 200, {
        ok: true,
        allowed: true,
        plan: entitlements.plan
      });
    }

    if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
      if (!stripe) {
        return json(res, 503, {
          ok: false,
          message: "GameSloth billing is not configured yet."
        });
      }

      const body = await readBody(req);
      const plan = normalizedPlan(body.plan);
      const cycle = body.cycle === "annual" ? "annual" : "monthly";
      const priceId = checkoutPrice(plan, cycle);

      if (!priceId) {
        return json(res, 400, {
          ok: false,
          message: "That GameSloth plan is not configured for checkout."
        });
      }

      let customerId = user.stripe_customer_id || null;

      if (user.stripe_subscription_id && ["active", "trialing", "past_due"].includes(String(user.subscription_status || ""))) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${PUBLIC_BASE_URL}/billing/success`
        });
        return json(res, 200, {
          ok: true,
          url: portal.url,
          mode: "portal",
          message: "Manage your current GameSloth plan in the secure billing portal."
        });
      }

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.display_name,
          metadata: {
            gamesloth_user_id: user.id,
            gamesloth_handle: user.handle
          }
        });
        customerId = customer.id;
        await query(
          `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
          [customerId, user.id]
        );
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        billing_address_collection: "auto",
        automatic_tax: { enabled: STRIPE_AUTOMATIC_TAX },
        success_url: `${PUBLIC_BASE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${PUBLIC_BASE_URL}/billing/cancel`,
        metadata: {
          gamesloth_user_id: user.id,
          gamesloth_plan: plan,
          gamesloth_cycle: cycle
        },
        subscription_data: {
          metadata: {
            gamesloth_user_id: user.id,
            gamesloth_plan: plan,
            gamesloth_cycle: cycle
          }
        }
      });

      return json(res, 200, {
        ok: true,
        url: session.url
      });
    }

    if (req.method === "POST" && url.pathname === "/api/billing/portal") {
      if (!stripe) {
        return json(res, 503, { ok: false, message: "GameSloth billing is not configured yet." });
      }
      if (!user.stripe_customer_id) {
        return json(res, 400, { ok: false, message: "No billing account exists yet." });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${PUBLIC_BASE_URL}/billing/success`
      });

      return json(res, 200, {
        ok: true,
        url: session.url
      });
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return json(res, 200, {
        ok: true,
        user: accountUser(user),
        entitlements: entitlementsForUser(user),
        friends: await friendsFor(user.id),
        requests: await requestsFor(user.id),
        blocked: await blockedFor(user.id),
        squadInvites: await squadInvitesFor(user.id),
        squads: await squadsFor(user.id)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/onboarding/complete") {
      const body = await readBody(req);
      const requested = Math.max(
        1,
        Math.min(CURRENT_ONBOARDING_VERSION, Number(body.version) || CURRENT_ONBOARDING_VERSION)
      );

      const result = await query(
        `UPDATE users
            SET onboarding_version = GREATEST(COALESCE(onboarding_version, 0), $2),
                updated_at = $3
          WHERE id = $1
          RETURNING *`,
        [user.id, requested, Date.now()]
      );

      return json(res, 200, {
        ok: true,
        onboardingVersion: Number(result.rows[0]?.onboarding_version || requested),
        user: accountUser(result.rows[0] || user)
      });
    }


    if (req.method === "POST" && url.pathname === "/api/logout") {
      const header = String(req.headers.authorization || "");
      const rawToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (rawToken) {
        await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(rawToken)]);
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/logout-all") {
      await invalidateUserSessions(user.id, "LOGOUT_ALL");
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname === "/api/account") {
      const body = await readBody(req);
      const password = String(body.password || "");
      const candidate = await hashPasswordAsync(password, user.salt);

      if (!timingSafeHexEqual(candidate, user.password_hash)) {
        return json(res, 403, { ok: false, message: "Password is incorrect." });
      }

      await query(`DELETE FROM users WHERE id = $1`, [user.id]);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/password") {
      const body = await readBody(req);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8) return json(res, 400, { ok: false, message: "New password must be at least 8 characters." });
      const currentHash = await hashPasswordAsync(currentPassword, user.salt);
      if (!timingSafeHexEqual(currentHash, user.password_hash)) return json(res, 403, { ok: false, message: "Current password is incorrect." });
      const newSalt = crypto.randomBytes(16).toString("hex");
      const newHash = await hashPasswordAsync(newPassword, newSalt);
      await withTransaction(async client => {
        await client.query(`UPDATE users SET password_hash = $1, salt = $2, updated_at = $3 WHERE id = $4`, [newHash, newSalt, Date.now(), user.id]);
        await client.query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [user.id, hashToken(String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "").trim())]);
      });
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/profile") {
      const body = await readBody(req);
      const displayName = String(body.displayName || user.display_name).trim().slice(0, 32);
      const handle = normalizeHandle(body.handle || user.handle);

      if (!displayName) {
        return json(res, 400, { ok: false, message: "Display name is required." });
      }

      if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
        return json(res, 400, { ok: false, message: "Invalid username." });
      }

      try {
        const result = await query(
          `UPDATE users
              SET display_name = $1, handle = $2, updated_at = $4
            WHERE id = $3
            RETURNING *`,
          [displayName, handle, user.id, Date.now()]
        );
        return json(res, 200, { ok: true, user: accountUser(result.rows[0]) });
      } catch (err) {
        if (err && err.code === "23505") {
          return json(res, 409, { ok: false, message: "That username is already taken." });
        }
        throw err;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/friends/request") {
      const body = await readBody(req);
      const targetResult = await query(
        `SELECT * FROM users WHERE handle = $1 LIMIT 1`,
        [normalizeHandle(body.handle)]
      );
      const target = targetResult.rows[0];

      if (!target) {
        return json(res, 404, { ok: false, message: "User not found." });
      }
      if (target.id === user.id) {
        return json(res, 400, { ok: false, message: "You cannot add yourself." });
      }
      if (await isFriend(user.id, target.id)) {
        return json(res, 200, { ok: true, message: "Already friends." });
      }
      if (await isBlocked(target.id, user.id)) {
        return json(res, 200, {
          ok: true,
          message: `Friend request sent to @${target.handle}.`
        });
      }

      await query(
        `INSERT INTO friend_requests (from_user_id, to_user_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (from_user_id, to_user_id) DO NOTHING`,
        [user.id, target.id, Date.now()]
      );

      return json(res, 200, {
        ok: true,
        message: `Friend request sent to @${target.handle}.`
      });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/decline") {
      const body = await readBody(req);
      const fromUserId = String(body.userId || "");

      await query(
        `DELETE FROM friend_requests
          WHERE from_user_id = $1 AND to_user_id = $2`,
        [fromUserId, user.id]
      );

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/block") {
      const body = await readBody(req);
      const targetUserId = String(body.userId || "");

      if (!targetUserId || targetUserId === user.id) {
        return json(res, 400, { ok: false, message: "Invalid target user." });
      }

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO blocked_users (user_id, blocked_user_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
          [user.id, targetUserId, Date.now()]
        );

        await client.query(
          `DELETE FROM friend_requests
            WHERE (from_user_id = $1 AND to_user_id = $2)
               OR (from_user_id = $2 AND to_user_id = $1)`,
          [targetUserId, user.id]
        );

        await client.query(
          `DELETE FROM friendships
            WHERE (user_id = $1 AND friend_id = $2)
               OR (user_id = $2 AND friend_id = $1)`,
          [user.id, targetUserId]
        );
      });

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/unblock") {
      const body = await readBody(req);
      const targetUserId = String(body.userId || "");

      await query(
        `DELETE FROM blocked_users
          WHERE user_id = $1 AND blocked_user_id = $2`,
        [user.id, targetUserId]
      );

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/accept") {
      const body = await readBody(req);
      const fromUserId = String(body.userId || "");

      const accepted = await withTransaction(async (client) => {
        const request = await client.query(
          `SELECT 1
             FROM friend_requests
            WHERE from_user_id = $1 AND to_user_id = $2
            LIMIT 1`,
          [fromUserId, user.id]
        );

        if (!request.rowCount) return false;

        await client.query(
          `DELETE FROM friend_requests
            WHERE from_user_id = $1 AND to_user_id = $2`,
          [fromUserId, user.id]
        );

        const now = Date.now();
        await client.query(
          `INSERT INTO friendships (user_id, friend_id, created_at)
           VALUES ($1, $2, $3), ($2, $1, $3)
           ON CONFLICT (user_id, friend_id) DO NOTHING`,
          [user.id, fromUserId, now]
        );

        return true;
      });

      if (!accepted) {
        return json(res, 404, { ok: false, message: "Friend request not found." });
      }

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/friends/remove") {
      const body = await readBody(req);
      const otherId = String(body.userId || "");

      await query(
        `DELETE FROM friendships
          WHERE (user_id = $1 AND friend_id = $2)
             OR (user_id = $2 AND friend_id = $1)`,
        [user.id, otherId]
      );

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/squads") {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 32);
      const inviteUserIds = Array.isArray(body.inviteUserIds)
        ? [...new Set(body.inviteUserIds.map(value => String(value || "").trim()).filter(Boolean))].slice(0, 15)
        : [];

      if (name.length < 2) {
        return json(res, 400, { ok: false, message: "Enter a squad name." });
      }

      if (inviteUserIds.includes(user.id)) {
        return json(res, 400, { ok: false, message: "You are already the squad owner." });
      }

      if (inviteUserIds.length) {
        const friends = await query(
          `SELECT friend_id
             FROM friendships
            WHERE user_id = $1`,
          [user.id]
        );

        const friendIds = new Set(friends.rows.map(row => row.friend_id));
        const invalid = inviteUserIds.find(id => !friendIds.has(id));

        if (invalid) {
          return json(res, 400, {
            ok: false,
            message: "Squads can only invite people from your friends list."
          });
        }
      }

      const created = await withTransaction(async (client) => {
        const id = createId("sqd");
        const now = Date.now();

        const result = await client.query(
          `INSERT INTO squads
            (id, name, owner_id, active_room_code, active_room_updated_at, created_at)
           VALUES ($1, $2, $3, NULL, NULL, $4)
           RETURNING *`,
          [id, name, user.id, now]
        );

        await client.query(
          `INSERT INTO squad_members (squad_id, user_id, created_at)
           VALUES ($1, $2, $3)`,
          [id, user.id, now]
        );

        let invitesCreated = 0;
        const invitedUsers = [];

        for (const friendId of inviteUserIds) {
          const invite = await client.query(
            `INSERT INTO squad_invites
              (squad_id, from_user_id, to_user_id, created_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (squad_id, to_user_id) DO NOTHING
             RETURNING squad_id`,
            [id, user.id, friendId, now]
          );

          if (invite.rowCount) {
            invitesCreated += 1;
            const invitedUser = await client.query(
              `SELECT * FROM users WHERE id = $1 LIMIT 1`,
              [friendId]
            );
            if (invitedUser.rows[0]) invitedUsers.push(publicUser(invitedUser.rows[0]));
          }
        }

        return {
          squad: result.rows[0],
          invitesCreated,
          invitedUsers
        };
      });

      return json(res, 201, {
        ok: true,
        squad: await squadView(created.squad),
        invitesCreated: created.invitesCreated,
        invitedUsers: created.invitedUsers
      });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/invite") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const friendId = String(body.userId || "");
      const squad = await squadById(squadId);

      if (!squad || squad.owner_id !== user.id) {
        return json(res, 403, {
          ok: false,
          message: "Only the squad owner can invite players."
        });
      }

      if (!friendId || friendId === user.id) {
        return json(res, 400, { ok: false, message: "Choose a friend to invite." });
      }

      if (!(await isFriend(user.id, friendId))) {
        return json(res, 400, {
          ok: false,
          message: "Add this player as a friend first."
        });
      }

      if (await squadMembershipExists(squadId, friendId)) {
        return json(res, 400, {
          ok: false,
          message: "This friend is already in the squad."
        });
      }

      const inserted = await query(
        `INSERT INTO squad_invites (squad_id, from_user_id, to_user_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (squad_id, to_user_id) DO NOTHING
         RETURNING squad_id`,
        [squadId, user.id, friendId, Date.now()]
      );

      const invitedUserResult = await query(
        `SELECT * FROM users WHERE id = $1 LIMIT 1`,
        [friendId]
      );

      return json(res, 200, {
        ok: true,
        pending: true,
        alreadyPending: inserted.rowCount === 0,
        invitedUser: invitedUserResult.rows[0] ? publicUser(invitedUserResult.rows[0]) : null,
        squad: await squadView(squad),
        message: inserted.rowCount
          ? "Squad invite sent."
          : "Squad invite is already pending."
      });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/invite/accept") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");

      const result = await withTransaction(async (client) => {
        const inviteResult = await client.query(
          `SELECT si.*, s.name AS squad_name
             FROM squad_invites si
             JOIN squads s ON s.id = si.squad_id
            WHERE si.squad_id = $1 AND si.to_user_id = $2
            LIMIT 1
            FOR UPDATE`,
          [squadId, user.id]
        );

        const invite = inviteResult.rows[0];
        if (!invite) return null;

        await client.query(
          `INSERT INTO squad_members (squad_id, user_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (squad_id, user_id) DO NOTHING`,
          [squadId, user.id, Date.now()]
        );

        await client.query(
          `DELETE FROM squad_invites WHERE squad_id = $1 AND to_user_id = $2`,
          [squadId, user.id]
        );

        return invite;
      });

      if (!result) {
        return json(res, 404, { ok: false, message: "This squad invite is no longer available." });
      }

      return json(res, 200, {
        ok: true,
        squad: await squadView(await squadById(squadId))
      });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/invite/decline") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");

      const result = await query(
        `DELETE FROM squad_invites
          WHERE squad_id = $1 AND to_user_id = $2
          RETURNING squad_id`,
        [squadId, user.id]
      );

      if (!result.rowCount) {
        return json(res, 404, { ok: false, message: "This squad invite is no longer available." });
      }

      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/add") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const friendId = String(body.userId || "");
      const squad = await squadById(squadId);

      if (!squad || squad.owner_id !== user.id) {
        return json(res, 403, {
          ok: false,
          message: "Only the squad owner can add players."
        });
      }

      if (!(await isFriend(user.id, friendId))) {
        return json(res, 400, {
          ok: false,
          message: "Add this player as a friend first."
        });
      }

      await query(
        `INSERT INTO squad_members (squad_id, user_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (squad_id, user_id) DO NOTHING`,
        [squadId, friendId, Date.now()]
      );

      return json(res, 200, {
        ok: true,
        squad: await squadView(await squadById(squadId))
      });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/leave") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const squad = await squadById(squadId);

      if (!squad) {
        return json(res, 404, { ok: false, message: "Squad not found." });
      }

      const membership = await query(
        `SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 LIMIT 1`,
        [squadId, user.id]
      );

      if (!membership.rowCount) {
        return json(res, 404, { ok: false, message: "Squad not found." });
      }

      if (squad.owner_id === user.id) {
        return json(res, 400, {
          ok: false,
          message: "Squad owners cannot leave their own squad. Use Delete Squad instead."
        });
      }

      await query(
        `DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2`,
        [squadId, user.id]
      );

      disconnectUserFromSquadRoom(squadId, user.id, "You left the squad.");
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/rename") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const name = String(body.name || "").trim().slice(0, 32);
      const squad = await squadById(squadId);
      if (!squad) return json(res, 404, { ok: false, message: "Squad not found." });
      if (squad.owner_id !== user.id) return json(res, 403, { ok: false, message: "Only the squad owner can rename the squad." });
      if (name.length < 2) return json(res, 400, { ok: false, message: "Use a squad name of at least 2 characters." });
      const result = await query(`UPDATE squads SET name = $1 WHERE id = $2 RETURNING *`, [name, squadId]);
      return json(res, 200, { ok: true, squad: await squadView(result.rows[0]) });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/kick") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const targetId = String(body.userId || "");
      const squad = await squadById(squadId);
      if (!squad) return json(res, 404, { ok: false, message: "Squad not found." });
      if (squad.owner_id !== user.id) return json(res, 403, { ok: false, message: "Only the squad owner can remove members." });
      if (!targetId || targetId === squad.owner_id) return json(res, 400, { ok: false, message: "The squad owner cannot be removed." });
      const removed = await query(`DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2 RETURNING user_id`, [squadId, targetId]);
      if (!removed.rowCount) return json(res, 404, { ok: false, message: "That player is not in this squad." });
      disconnectUserFromSquadRoom(squadId, targetId, "You were removed from the squad.");
      return json(res, 200, { ok: true, squad: await squadView(await squadById(squadId)) });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/invite/cancel") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const targetId = String(body.userId || "");
      const squad = await squadById(squadId);
      if (!squad) return json(res, 404, { ok: false, message: "Squad not found." });
      if (squad.owner_id !== user.id) return json(res, 403, { ok: false, message: "Only the squad owner can cancel invites." });
      const removed = await query(`DELETE FROM squad_invites WHERE squad_id = $1 AND to_user_id = $2 RETURNING to_user_id`, [squadId, targetId]);
      if (!removed.rowCount) return json(res, 404, { ok: false, message: "That invite is no longer pending." });
      return json(res, 200, { ok: true, squad: await squadView(await squadById(squadId)) });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/delete") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const confirmName = String(body.confirmName || "").trim();
      const squad = await squadById(squadId);
      if (!squad) return json(res, 404, { ok: false, message: "Squad not found." });
      if (squad.owner_id !== user.id) return json(res, 403, { ok: false, message: "Only the squad owner can delete the squad." });
      if (confirmName !== squad.name) return json(res, 400, { ok: false, message: "Type the squad name exactly to confirm deletion." });
      endRoomsForSquad(squadId, "The squad owner deleted this squad.");
      await query(`DELETE FROM squads WHERE id = $1`, [squadId]);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/squads/active-room") {
      const body = await readBody(req);
      const squadId = String(body.squadId || "");
      const requestedRoomCode = body.roomCode == null
        ? null
        : String(body.roomCode).trim().toUpperCase() || null;
      const roomCode = requestedRoomCode && /^[A-F0-9]{6}$/.test(requestedRoomCode)
        ? requestedRoomCode
        : null;

      const squad = await squadById(squadId);
      if (!squad) {
        return json(res, 404, { ok: false, message: "Squad not found." });
      }

      const membership = await query(
        `SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 LIMIT 1`,
        [squadId, user.id]
      );

      if (!membership.rowCount) {
        return json(res, 404, { ok: false, message: "Squad not found." });
      }

      if (squad.owner_id !== user.id) {
        return json(res, 403, {
          ok: false,
          message: "Only the squad owner can start squad sync."
        });
      }

      const result = await query(
        `UPDATE squads
            SET active_room_code = $1,
                active_room_updated_at = $2
          WHERE id = $3
          RETURNING *`,
        [roomCode, roomCode ? Date.now() : null, squadId]
      );

      return json(res, 200, {
        ok: true,
        squad: await squadView(result.rows[0])
      });
    }

    return json(res, 404, { ok: false, message: "Not found." });
  } catch (err) {
    console.error("[http]", err);
    if (err?.statusCode) return json(res, err.statusCode, { ok: false, message: err.message || "Request failed." });
    return json(res, 500, {
      ok: false,
      message: "GameSloth server error."
    });
  }
});

/* ---------------- Sloth Sync WebSocket relay ---------------- */

const wss = new WebSocket.Server({
  server,
  maxPayload: 2 * 1024 * 1024
});

const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function roster(room) {
  return [...room.clients.values()].map((client) => ({
    id: client.id,
    userId: client.userId,
    name: client.name,
    host: client.host,
    recording: !!client.recording,
    acceptTriggers: client.acceptTriggers !== false,
    sharePov: client.sharePov !== false,
    ready: !!client.recording &&
      client.acceptTriggers !== false &&
      (client.host || client.sharePov !== false),
    lastSeenAt: Number(client.lastSeenAt || Date.now())
  }));
}

function broadcast(room, data, except = null) {
  for (const client of room.clients.values()) {
    if (client.ws !== except) send(client.ws, data);
  }
}

function roomLimitPayload(room) {
  return {
    hostPlan: room.hostPlan,
    hostPlanLabel: planDisplayName(room.hostPlan),
    maxPovs: room.maxPovs,
    currentPovs: room.clients.size
  };
}

function emitRoster(room) {
  broadcast(room, {
    type: "roster",
    members: roster(room),
    ...roomLimitPayload(room)
  });
}

function refreshRoomHeartbeat(room) {
  if (!room?.squadId || !room?.code) return;
  const now = Date.now();
  if (now - Number(room.lastDbHeartbeat || 0) < 60_000) return;

  room.lastDbHeartbeat = now;
  query(
    `UPDATE squads
        SET active_room_updated_at = $1
      WHERE id = $2 AND active_room_code = $3`,
    [now, room.squadId, room.code]
  ).catch(err => console.error("[ws] room heartbeat failed", err));
}

function clearSquadRoomDatabase(room) {
  query(
    `UPDATE squads SET active_room_code = NULL, active_room_updated_at = NULL WHERE id = $1 AND active_room_code = $2`,
    [room.squadId, room.code]
  ).catch(err => console.error("[ws] could not clear room", err));
}

function endRoom(room, message = "Sloth Sync ended.") {
  if (!room) return;
  rooms.delete(room.code);
  for (const client of room.clients.values()) {
    send(client.ws, { type: "session_ended", message });
    client.ws._roomCode = null;
    client.ws._clientId = null;
    client.ws._userId = null;
    try { client.ws.close(4002, "Session ended"); } catch { }
  }
  room.clients.clear();
  room.uploads.clear();
  clearSquadRoomDatabase(room);
}

function endRoomsForSquad(squadId, message) {
  for (const room of [...rooms.values()]) {
    if (room.squadId === squadId) endRoom(room, message);
  }
}

function disconnectUserFromSquadRoom(squadId, userId, message) {
  for (const room of rooms.values()) {
    if (room.squadId !== squadId) continue;
    for (const client of [...room.clients.values()]) {
      if (client.userId !== userId) continue;
      send(client.ws, { type: "session_ended", message });
      try { client.ws.close(4003, "Removed from squad"); } catch { }
    }
  }
}

function disconnectUserFromAllRooms(userId, message = "Logged out: Your account was signed in on another device.") {
  for (const room of rooms.values()) {
    for (const client of [...room.clients.values()]) {
      if (client.userId === userId || client.ws?._userId === userId) {
        send(client.ws, { type: "session_ended", message });
        try { client.ws.close(4002, "Concurrent login"); } catch { }
      }
    }
  }
}

function leaveRoom(ws) {
  if (!ws._roomCode) return;

  const room = rooms.get(ws._roomCode);
  if (!room) {
    ws._roomCode = null;
    return;
  }

  const leaving = room.clients.get(ws._clientId);
  if (room.hostId === ws._clientId) {
    endRoom(room, "The squad owner ended Sloth Sync.");
    return;
  }

  room.clients.delete(ws._clientId);

  for (const [uploadId, upload] of room.uploads || []) {
    if (upload.senderId === ws._clientId) room.uploads.delete(uploadId);
  }

  if (!room.clients.size) {
    rooms.delete(ws._roomCode);
    clearSquadRoomDatabase(room);
  } else {
    if (leaving) broadcast(room, { type: "member_left", id: leaving.id, name: leaving.name });
    emitRoster(room);
  }

  ws._roomCode = null;
  ws._clientId = null;
  ws._userId = null;
}

function consumeControlMessage(ws) {
  const now = Date.now();
  if (!ws._controlRate || now - ws._controlRate.startedAt >= CONTROL_RATE_WINDOW_MS) {
    ws._controlRate = { startedAt: now, count: 1 };
    return true;
  }
  ws._controlRate.count += 1;
  return ws._controlRate.count <= CONTROL_RATE_MAX;
}

async function authenticateSync(message) {
  return authenticatedUserFromToken(message.token);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws._controlRate = { startedAt: Date.now(), count: 0 };

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Invalid Sloth Sync message." });
    }

    try {
      const isChunk = message.type === "clip_chunk";
      if (!isChunk && !consumeControlMessage(ws)) {
        send(ws, { type: "error", message: "Too many Sloth Sync requests." });
        return;
      }

      if (message.type === "create_room") {
        const user = await authenticateSync(message);
        const squadId = String(message.squadId || "");

        if (!user) {
          send(ws, { type: "error", message: "Sign in again before starting Sloth Sync.", code: "AUTH_REQUIRED" });
          return;
        }

        const squad = await squadById(squadId);
        if (!squad || squad.owner_id !== user.id) {
          send(ws, { type: "error", message: "Only the squad owner can start this Sloth Sync.", code: "SQUAD_FORBIDDEN" });
          return;
        }

        if (!(await isSquadMember(user.id, squadId))) {
          send(ws, { type: "error", message: "You are not a member of this squad.", code: "SQUAD_FORBIDDEN" });
          return;
        }

        leaveRoom(ws);

        let code = createRoomCode();
        while (rooms.has(code)) code = createRoomCode();

        const clientId = String(message.id || createId("client")).slice(0, 80) || createId("client");
        const hostPlan = effectivePlan(user);
        const room = {
          code,
          squadId,
          ownerUserId: user.id,
          hostPlan,
          maxPovs: Math.min(MAX_ROOM_MEMBERS, maxPovsForPlan(hostPlan)),
          clients: new Map(),
          uploads: new Map(),
          hostId: clientId,
          recentTriggers: new Map(),
          lastTriggerAtByClient: new Map(),
          createdAt: Date.now(),
          lastDbHeartbeat: Date.now()
        };

        const client = {
          id: clientId,
          userId: user.id,
          name: String(user.display_name || "Player").slice(0, 24),
          host: true,
          recording: false,
          acceptTriggers: true,
          sharePov: true,
          lastSeenAt: Date.now(),
          ws
        };

        rooms.set(code, room);
        room.clients.set(client.id, client);
        refreshRoomHeartbeat(room);
        ws._roomCode = code;
        ws._clientId = client.id;
        ws._userId = user.id;

        await query(
          `UPDATE squads
              SET active_room_code = $1, active_room_updated_at = $2
            WHERE id = $3`,
          [code, Date.now(), squadId]
        );

        send(ws, {
          type: "room_joined",
          roomCode: code,
          squadId,
          members: roster(room),
          host: true,
          ...roomLimitPayload(room)
        });
        emitRoster(room);
        return;
      }

      if (message.type === "join_room") {
        const user = await authenticateSync(message);
        const code = String(message.roomCode || "").trim().toUpperCase();
        const room = rooms.get(code);

        if (!user) {
          send(ws, { type: "error", message: "Sign in again before joining Sloth Sync.", code: "AUTH_REQUIRED" });
          return;
        }

        if (!room) {
          send(ws, { type: "error", message: "This squad Sync is no longer active.", code: "ROOM_NOT_FOUND" });
          return;
        }

        if (!(await isSquadMember(user.id, room.squadId))) {
          send(ws, { type: "error", message: "Only members of this squad can join its Sync.", code: "SQUAD_FORBIDDEN" });
          return;
        }

        leaveRoom(ws);

        let clientId = String(message.id || createId("client")).slice(0, 80) || createId("client");
        const idCollision = room.clients.get(clientId);
        if (idCollision && idCollision.userId !== user.id) {
          clientId = createId("client");
        }

        const existingForUser = [...room.clients.values()].find(client => client.userId === user.id);
        const occupiesNewPovSlot = !existingForUser;

        if (occupiesNewPovSlot && room.clients.size >= room.maxPovs) {
          const label = planDisplayName(room.hostPlan);
          send(ws, {
            type: "error",
            code: "HOST_POV_LIMIT",
            hostPlan: room.hostPlan,
            hostPlanLabel: label,
            maxPovs: room.maxPovs,
            currentPovs: room.clients.size,
            message: `The host's ${label} plan supports up to ${room.maxPovs} POVs. Only the host needs to upgrade.`
          });
          return;
        }

        if (existingForUser && existingForUser.ws !== ws) {
          try { existingForUser.ws.close(4001, "Reconnected from another session"); } catch { }
          room.clients.delete(existingForUser.id);
        }

        const client = {
          id: clientId,
          userId: user.id,
          name: String(user.display_name || "Player").slice(0, 24),
          host: false,
          recording: false,
          acceptTriggers: true,
          sharePov: true,
          lastSeenAt: Date.now(),
          ws
        };

        room.clients.set(client.id, client);
        ws._roomCode = code;
        ws._clientId = client.id;
        ws._userId = user.id;

        send(ws, {
          type: "room_joined",
          roomCode: code,
          squadId: room.squadId,
          members: roster(room),
          host: false,
          ...roomLimitPayload(room)
        });
        emitRoster(room);
        return;
      }

      const room = rooms.get(ws._roomCode);
      if (!room) return;

      const sender = room.clients.get(ws._clientId);
      if (!sender || sender.userId !== ws._userId) return;

      if (message.type === "presence") {
        sender.recording = !!message.recording;
        sender.acceptTriggers = message.acceptTriggers !== false;
        sender.sharePov = message.sharePov !== false;
        sender.lastSeenAt = Date.now();
        refreshRoomHeartbeat(room);
        emitRoster(room);
        return;
      }

      if (message.type === "pov_status") {
        const host = room.clients.get(room.hostId);
        if (host && host.id !== sender.id) {
          send(host.ws, {
            type: "pov_status",
            momentId: String(message.momentId || "").slice(0, 160),
            senderId: sender.id,
            playerName: sender.name,
            status: String(message.status || "waiting").slice(0, 40),
            progress: Math.max(0, Math.min(100, Number(message.progress) || 0)),
            message: String(message.message || "").slice(0, 200)
          });
        }
        return;
      }

      if (message.type === "trigger") {
        sender.lastSeenAt = Date.now();
        refreshRoomHeartbeat(room);
        const triggerId = String(message.triggerId || "").slice(0, 120);
        if (!triggerId) return;
        const now = Date.now();
        const lastAt = Number(room.lastTriggerAtByClient.get(sender.id) || 0);
        if (now - lastAt < 1800) {
          send(ws, { type: "trigger_rejected", triggerId, message: "A squad clip was just triggered. Give the replay a second." });
          return;
        }
        if (room.recentTriggers.has(triggerId)) return;

        if (room.clients.size >= 2) {
          const reservation = await reserveMultiPovMomentSaveByUserId(room.ownerUserId, {
            momentKey: triggerId,
            source: "sloth-sync-online",
            povCount: room.clients.size
          });

          if (!reservation.allowed) {
            send(ws, {
              type: "trigger_rejected",
              triggerId,
              code: reservation.code || "MONTHLY_MULTI_POV_LIMIT",
              quota: reservation.quota,
              message: reservation.message || "The host's monthly multi-POV save allowance has been reached."
            });
            return;
          }
        }

        room.lastTriggerAtByClient.set(sender.id, now);
        room.recentTriggers.set(triggerId, now);

        await leaderboard.recordTrigger({
          momentId: triggerId,
          creatorId: sender.userId,
          hostId: room.ownerUserId,
          roomCode: room.code,
          members: [...room.clients.values()]
        }).catch(() => console.warn("[leaderboard] Moment registration unavailable; recording continues."));

        broadcast(room, {
          type: "trigger",
          triggerId,
          by: sender.name,
          byId: sender.id,
          game: String(message.game || "Gameplay").slice(0, 100),
          timestamp: Number(message.timestamp) || Date.now()
        }, ws);
        return;
      }

      if (message.type === "clip_begin") {
        const uploadId = String(message.uploadId || "").slice(0, 180);
        const momentId = String(message.momentId || "").slice(0, 120);
        const size = Number(message.size) || 0;

        if (!momentId || !room.recentTriggers.has(momentId)) {
          send(ws, { type: "clip_ack", uploadId, momentId, ok: false, message: "This Shared Moment was not accepted by the host plan." });
          return;
        }

        if (!uploadId || size <= 0 || size > 2 * 1024 * 1024 * 1024) {
          send(ws, { type: "clip_ack", uploadId, ok: false, message: "Invalid POV upload." });
          return;
        }

        room.uploads.set(uploadId, { senderId: sender.id, startedAt: Date.now() });
        const host = room.clients.get(room.hostId);

        if (host && host.ws !== ws) {
          send(host.ws, { ...message, senderId: sender.id, playerName: sender.name });
        }
        return;
      }

      if (message.type === "clip_chunk" || message.type === "clip_end") {
        const uploadId = String(message.uploadId || "");
        const upload = room.uploads.get(uploadId);
        if (!upload || upload.senderId !== sender.id) return;

        const host = room.clients.get(room.hostId);
        if (host && host.ws !== ws) {
          send(host.ws, { ...message, senderId: sender.id, playerName: sender.name });
        }
        return;
      }

      if (message.type === "clip_ack") {
        if (ws._clientId !== room.hostId) return;

        const uploadId = String(message.uploadId || "");
        const upload = room.uploads.get(uploadId);
        if (!upload) return;

        const original = room.clients.get(upload.senderId);
        if (original) {
          send(original.ws, {
            type: "clip_ack",
            uploadId,
            momentId: String(message.momentId || ""),
            ok: !!message.ok,
            message: String(message.message || "").slice(0, 200)
          });
        }
        room.uploads.delete(uploadId);
        return;
      }

      if (message.type === "moment_status") {
        if (ws._clientId === room.hostId) {
          const status = message.status || {};
          await leaderboard.completeMoment({
            hostId: room.ownerUserId,
            roomCode: room.code,
            status
          }).catch(() => console.warn("[leaderboard] Moment completion unavailable; recording continues."));

          if (["ready", "partial"].includes(String(status.status || "")) && status.momentId && Array.isArray(status.players)) {
            const readyUsers = new Set();
            for (const player of status.players.slice(0, 16)) {
              if (!player || player.status !== "ready") continue;
              const roomClient = room.clients.get(String(player.id || ""));
              if (roomClient?.userId) readyUsers.add(roomClient.userId);
            }
            if (readyUsers.size >= 2) {
              try {
                const reward = await claimFounding50Reward(room.ownerUserId, {
                  momentKey: status.momentId,
                  povCount: readyUsers.size
                });
                if (reward.awarded) {
                  const host = room.clients.get(room.hostId);
                  if (host) {
                    send(host.ws, {
                      type: "founding_50_awarded",
                      position: reward.position,
                      plan: reward.plan,
                      expiresAt: reward.expiresAt,
                      message: `You’re Founding 50 #${reward.position}. Sloth+ is unlocked for 2 years.`
                    });
                  }
                  console.log(`[founding-50] @${reward.user?.handle || room.ownerUserId} claimed #${reward.position}`);
                }
              } catch (err) {
                console.warn("[founding-50] reward check failed; Moment remains saved.", err.message);
              }
            }
          }

          if (status.status === "failed" && Number(status.ready || 0) === 0 && status.momentId) {
            await releaseFailedMultiPovMomentSave(room.ownerUserId, status.momentId).catch(() => { });
          }
          broadcast(room, { type: "moment_status", status }, ws);
        }
        return;
      }

      if (message.type === "rename") {
        const client = room.clients.get(ws._clientId);
        if (client) {
          client.name = String(message.name || client.name || "Player").trim().slice(0, 24) || client.name;
          emitRoster(room);
        }
      }
    } catch (err) {
      console.error("[ws]", err);
      send(ws, { type: "error", message: "Sloth Sync could not process that request." });
    }
  });

  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [uploadId, upload] of room.uploads || []) {
      if (now - upload.startedAt > 15 * 60 * 1000) room.uploads.delete(uploadId);
    }
    for (const [triggerId, createdAt] of room.recentTriggers || []) {
      if (now - createdAt > 60_000) room.recentTriggers.delete(triggerId);
    }
  }

  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch { }
  }
}, 30_000);

server.on("close", () => {
  leaderboard.stop();
  clearInterval(heartbeat);
});

/* ---------------- Startup ---------------- */

async function start() {
  await initSchema();
  await cleanupExpiredSessions();
  leaderboard.start();

  setInterval(cleanupExpiredSessions, 60 * 60 * 1000).unref();

  server.listen(PORT, HOST, () => {
    console.log(`GameSloth server listening on ${HOST}:${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  leaderboard.stop();
  clearInterval(heartbeat);

  for (const ws of wss.clients) {
    try {
      ws.close(1001, "Server shutting down");
    } catch { }
  }

  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("[startup] failed", err);
  process.exit(1);
});
