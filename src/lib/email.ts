import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "re_placeholder");

export async function sendNewLeadAlert(newLeads: any[]) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_ADDRESS) {
    console.warn("RESEND_API_KEY or ALERT_EMAIL_ADDRESS not set. Skipping email notification.");
    return false;
  }

  const leadCount = newLeads.length;
  if (leadCount === 0) return false;

  const title = `🚨 ${leadCount} New Lead${leadCount > 1 ? 's' : ''} Received!`;

  const leadDetailsHtml = newLeads.map(lead => {
    // Attempt to extract name/email/phone from field_data if available
    const fields = lead.field_data || {};
    const name = fields["full_name"] || fields["name"] || "N/A";
    const email = fields["email"] || "N/A";
    const phone = fields["phone_number"] || fields["phone"] || "N/A";

    return `
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background-color: #f8fafc;">
        <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px;">Campaign: ${lead.campaign_name || "Unknown"}</h3>
        <p style="margin: 0 0 4px 0; color: #334155; font-size: 14px;"><strong>Project:</strong> ${lead.project_name || "N/A"}</p>
        <p style="margin: 0 0 4px 0; color: #334155; font-size: 14px;"><strong>Name:</strong> ${name}</p>
        <p style="margin: 0 0 4px 0; color: #334155; font-size: 14px;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 0 0 4px 0; color: #334155; font-size: 14px;"><strong>Phone:</strong> ${phone}</p>
      </div>
    `;
  }).join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb; font-size: 24px; margin-bottom: 24px;">${title}</h1>
      <p style="color: #475569; font-size: 16px; margin-bottom: 24px;">
        You have received ${leadCount} new lead${leadCount > 1 ? 's' : ''} from your Meta Ads campaigns.
      </p>
      ${leadDetailsHtml}
      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 14px;">
          View full details in your CRM dashboard.
        </p>
      </div>
    </div>
  `;

  try {
    const response = await resend.emails.send({
      from: "Meta Ads CRM <onboarding@resend.dev>",
      to: process.env.ALERT_EMAIL_ADDRESS,
      subject: title,
      html: html,
    });
    
    if (response.error) {
      console.error("Resend API Error:", response.error);
      return false;
    }

    return !!response.data?.id;
  } catch (error) {
    console.error("Error sending email via Resend:", error);
    return false;
  }
}

function generateLeadsCSV(leads: any[]): string {
  const headers = ["Date", "Project", "Name", "Phone Number", "Email", "Location", "Configuration", "Remark"];
  // RFC 4180 quoting: wrap every cell and double any embedded quotes
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = leads.map(lead => {
    const fields = lead.field_data || {};
    const name = fields["full_name"] || fields["name"] || "N/A";
    const email = fields["email"] || "N/A";
    const phone = fields["phone_number"] || fields["phone"] || "N/A";
    const location = fields["city"] || fields["location"] || fields["where_are_you_looking_to_buy_property?"] || "N/A";
    const config = fields["configuration"] || fields["project_configuration"] || fields["what_type_of_property_are_you_looking_for?"] || "N/A";
    const created = lead.created_time
      ? new Date(lead.created_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      : "";

    return [created, lead.project_name || "", name, phone, email, location, config, ""].map(cell).join(",");
  });

  // BOM so Excel opens UTF-8 (₹, Hindi names) correctly
  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
}

export async function sendDailyReport(yesterdaysLeads: any[], dateStr: string) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_ADDRESS) {
    console.warn("RESEND_API_KEY or ALERT_EMAIL_ADDRESS not set.");
    return false;
  }

  const leadCount = yesterdaysLeads.length;
  const title = `📊 Daily Leads Report - ${dateStr}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb; font-size: 24px; margin-bottom: 24px;">${title}</h1>
      <p style="color: #475569; font-size: 16px; margin-bottom: 24px;">
        Good morning! You generated <strong>${leadCount}</strong> new leads yesterday.
      </p>
      <p style="color: #475569; font-size: 16px; margin-bottom: 24px;">
        Please find the detailed Excel/CSV report attached to this email. It contains the following columns formatted for your sales team:
      </p>
      <ul style="color: #475569; font-size: 14px; margin-bottom: 24px;">
        <li>Date &amp; Project</li>
        <li>Name</li>
        <li>Phone Number</li>
        <li>Email</li>
        <li>Location</li>
        <li>Configuration</li>
        <li>Remark (Blank)</li>
      </ul>
      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 14px;">
          View full details in your CRM dashboard.
        </p>
      </div>
    </div>
  `;

  try {
    const csvContent = generateLeadsCSV(yesterdaysLeads);
    const base64Content = Buffer.from(csvContent).toString("base64");

    const response = await resend.emails.send({
      from: "Meta Ads CRM <onboarding@resend.dev>",
      to: process.env.ALERT_EMAIL_ADDRESS,
      subject: title,
      html: html,
      attachments: [
        {
          filename: `leads_report_${dateStr}.csv`,
          content: base64Content,
        }
      ]
    });
    
    if (response.error) {
      console.error("Resend API Error (Daily Report):", response.error);
      return false;
    }

    return !!response.data?.id;
  } catch (error) {
    console.error("Error sending daily report email:", error);
    return false;
  }
}

