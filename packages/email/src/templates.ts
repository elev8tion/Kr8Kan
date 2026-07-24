/**
 * Kr8Kan transactional email templates — SMTP only, brand "Kr8Kan".
 * Four templates exist: MAGIC_LINK, JOIN_WORKSPACE, RESET_PASSWORD, MENTION.
 * Plain HTML strings on purpose: no cloud template service, trivially
 * auditable, renders everywhere.
 */

export type EmailTemplate =
  | { type: "MAGIC_LINK"; url: string }
  | { type: "JOIN_WORKSPACE"; workspaceName: string; inviteUrl: string }
  | { type: "RESET_PASSWORD"; url: string }
  | { type: "MENTION"; authorName: string; cardTitle: string; cardUrl: string };

const styles = {
  body: `margin:0;padding:32px 16px;background:#f6f5f2;font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;color:#141414;`,
  card: `max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #ddd8ce;border-radius:16px;padding:32px;`,
  h1: `font-size:20px;line-height:1.25;margin:0 0 12px;`,
  p: `font-size:14px;line-height:1.5;color:#5c5a55;margin:0 0 20px;`,
  button: `display:inline-block;background:#0f6b5c;color:#f4fffc;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px;`,
  footer: `font-size:12px;color:#5c5a55;margin-top:24px;text-align:center;`,
};

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="${styles.body}">
  <div style="${styles.card}">
    <div style="font-weight:700;font-size:16px;margin-bottom:20px;color:#0f6b5c;">Kr8Kan</div>
    <h1 style="${styles.h1}">${title}</h1>
    ${bodyHtml}
  </div>
  <div style="${styles.footer}">Kr8Kan — self-hosted kanban. This email was sent by your own instance.</div>
</body></html>`;
}

export function renderTemplate(template: EmailTemplate): {
  subject: string;
  html: string;
  text: string;
} {
  switch (template.type) {
    case "MAGIC_LINK":
      return {
        subject: "Your Kr8Kan sign-in link",
        html: shell(
          "Sign in to Kr8Kan",
          `<p style="${styles.p}">Click the button below to sign in. The link expires in 5 minutes.</p>
           <a href="${template.url}" style="${styles.button}">Sign in</a>`,
        ),
        text: `Sign in to Kr8Kan: ${template.url}`,
      };
    case "JOIN_WORKSPACE":
      return {
        subject: `You've been invited to ${template.workspaceName} on Kr8Kan`,
        html: shell(
          `Join ${template.workspaceName}`,
          `<p style="${styles.p}">You've been invited to collaborate in the <strong>${template.workspaceName}</strong> workspace.</p>
           <a href="${template.inviteUrl}" style="${styles.button}">Accept invite</a>`,
        ),
        text: `Join ${template.workspaceName} on Kr8Kan: ${template.inviteUrl}`,
      };
    case "RESET_PASSWORD":
      return {
        subject: "Reset your Kr8Kan password",
        html: shell(
          "Reset password",
          `<p style="${styles.p}">Click below to choose a new password. If you didn't request this, ignore this email.</p>
           <a href="${template.url}" style="${styles.button}">Reset password</a>`,
        ),
        text: `Reset your Kr8Kan password: ${template.url}`,
      };
    case "MENTION":
      return {
        subject: `${template.authorName} mentioned you on "${template.cardTitle}"`,
        html: shell(
          "You were mentioned",
          `<p style="${styles.p}"><strong>${template.authorName}</strong> mentioned you on the card <strong>${template.cardTitle}</strong>.</p>
           <a href="${template.cardUrl}" style="${styles.button}">Open card</a>`,
        ),
        text: `${template.authorName} mentioned you on "${template.cardTitle}": ${template.cardUrl}`,
      };
  }
}
