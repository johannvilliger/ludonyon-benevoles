import nodemailer, { type Transporter } from "nodemailer";

// Envoi d'emails via un serveur SMTP externe (ex. Office 365 :
// smtp.office365.com, port 587, STARTTLS). Voir .env.example pour les
// variables à renseigner ; tant qu'elles ne le sont pas, mailConfigured()
// renvoie false et les appelants doivent traiter l'envoi comme optionnel.
let transporter: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.SMTP_FROM
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      // 587 = STARTTLS (secure=false, upgradé automatiquement) ; 465 = TLS
      // direct (secure=true). Office 365 utilise 587/STARTTLS.
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

export interface MailAttachment {
  filename: string;
  path: string;
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<void> {
  if (!mailConfigured()) {
    throw new Error("SMTP non configuré");
  }
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: options.attachments,
  });
}
