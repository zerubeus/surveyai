import Link from "next/link";
import { Lock, Shield, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const LAST_UPDATED = "28 March 2026";
const CONTACT_EMAIL = "privacy@surveyai.app";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/landing" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-bold">SurveyAI Analyst</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/landing" className="hover:text-gray-900">Home</Link>
            <Link href="/setup" className="hover:text-gray-900">Setup</Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <Badge className="mb-4 bg-blue-50 text-blue-700 hover:bg-blue-50">
            <Lock className="mr-1.5 h-3 w-3" />
            Legal
          </Badge>
          <h1 className="mb-4 text-4xl font-bold">Data Protection &amp; Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Last updated: {LAST_UPDATED}</p>
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>
                SurveyAI Analyst is built for organisations that handle sensitive survey data — including data collected from vulnerable populations. We take data protection seriously and are committed to GDPR compliance.
              </p>
            </div>
          </div>
        </div>

        {/* Table of contents */}
        <div className="mb-12 rounded-xl border bg-gray-50 p-6">
          <h2 className="mb-3 font-semibold">Contents</h2>
          <ol className="space-y-1 text-sm text-blue-700">
            {[
              ["1", "Who we are"],
              ["2", "What data we collect"],
              ["3", "How we use your data"],
              ["4", "Data storage and security"],
              ["5", "Your survey data — special protections"],
              ["6", "Third-party processors"],
              ["7", "Data retention"],
              ["8", "Your rights (GDPR)"],
              ["9", "Cookies"],
              ["10", "Changes to this policy"],
              ["11", "Contact us"],
            ].map(([num, title]) => (
              <li key={num}>
                <a href={`#section-${num}`} className="hover:underline">
                  {num}. {title}
                </a>
              </li>
            ))}
          </ol>
        </div>

        <div className="prose prose-gray max-w-none space-y-10">

          {/* 1 */}
          <section id="section-1">
            <h2 className="text-xl font-bold mb-3">1. Who we are</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <p>
                <strong>SurveyAI Analyst</strong> ("the Platform", "we", "us") is an AI-powered survey data analysis platform operated for NGOs, research firms, academic institutions, and policy units.
              </p>
              <p>
                For the purposes of the UK and EU General Data Protection Regulation (GDPR), we act as a <strong>data controller</strong> for account and usage data, and as a <strong>data processor</strong> for survey datasets you upload.
              </p>
              <p>Contact: <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a></p>
            </div>
          </section>

          {/* 2 */}
          <section id="section-2">
            <h2 className="text-xl font-bold mb-3">2. What data we collect</h2>
            <div className="text-sm text-gray-700 space-y-4">
              <div>
                <h3 className="font-semibold mb-2">2.1 Account data (controller)</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Email address and encrypted password (via Supabase Auth)</li>
                  <li>Organisation name</li>
                  <li>Date and time of account creation</li>
                  <li>Last login timestamp</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">2.2 Project metadata (controller)</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Project names, descriptions, and research questions you enter</li>
                  <li>Configuration options (template, sampling method, geographic scope)</li>
                  <li>Timestamps of project creation and updates</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">2.3 Survey data (processor)</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>CSV/Excel files you upload ("datasets")</li>
                  <li>Questionnaire files (Word, PDF, XLSForm) you upload ("instruments")</li>
                  <li>Derived data: column statistics, quality scores, analysis results</li>
                  <li>Generated reports and exported files</li>
                </ul>
                <div className="mt-2 rounded bg-yellow-50 p-3 text-yellow-800">
                  <strong>Important:</strong> We are a data processor for your survey data. You remain the data controller for any personal data about survey respondents. Ensure you have a lawful basis for sharing that data with us.
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2">2.4 Technical data (controller)</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>IP address (logged by Supabase for security purposes)</li>
                  <li>Browser type and version (for technical support)</li>
                  <li>Error logs (anonymised stack traces, no personal data)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* 3 */}
          <section id="section-3">
            <h2 className="text-xl font-bold mb-3">3. How we use your data</h2>
            <div className="text-sm text-gray-700 space-y-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left font-semibold">Purpose</th>
                    <th className="border p-2 text-left font-semibold">Legal basis (GDPR Art. 6)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Providing the analysis service", "Contract performance (6(1)(b))"],
                    ["User authentication and account management", "Contract performance (6(1)(b))"],
                    ["Sending email confirmation and password reset", "Contract performance (6(1)(b))"],
                    ["AI-assisted analysis (Gemini API)", "Contract performance (6(1)(b)) — see §6"],
                    ["Security monitoring and fraud prevention", "Legitimate interest (6(1)(f))"],
                    ["Service improvement and bug fixing", "Legitimate interest (6(1)(f))"],
                    ["Legal compliance and responding to lawful requests", "Legal obligation (6(1)(c))"],
                  ].map(([purpose, basis]) => (
                    <tr key={purpose}>
                      <td className="border p-2">{purpose}</td>
                      <td className="border p-2 text-gray-600">{basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>We do <strong>not</strong> sell, rent, or share your data with third parties for marketing purposes.</p>
            </div>
          </section>

          {/* 4 */}
          <section id="section-4">
            <h2 className="text-xl font-bold mb-3">4. Data storage and security</h2>
            <div className="text-sm text-gray-700 space-y-3">
              <p>All data is stored in <strong>Supabase</strong>, a PostgreSQL-based platform with the following protections:</p>
              <ul className="list-disc ml-5 space-y-1">
                <li><strong>Row-Level Security (RLS)</strong>: Each user can only access their own projects. Organisation-based access control prevents cross-user data leakage.</li>
                <li><strong>Encryption at rest</strong>: All database data and file storage is encrypted using AES-256.</li>
                <li><strong>Encryption in transit</strong>: All communication uses TLS 1.2+.</li>
                <li><strong>Private file storage</strong>: Uploaded datasets and questionnaires are stored in private S3-compatible buckets. Access requires a signed URL valid for 7 days.</li>
                <li><strong>Authentication</strong>: Passwords are hashed using bcrypt. Email confirmation is required for new accounts.</li>
              </ul>
              <p>We conduct periodic security reviews and apply security patches promptly.</p>
            </div>
          </section>

          {/* 5 */}
          <section id="section-5">
            <h2 className="text-xl font-bold mb-3">5. Your survey data — special protections</h2>
            <div className="text-sm text-gray-700 space-y-3">
              <p>Survey datasets may contain personal data about respondents (names, locations, demographic characteristics). As the uploader, you are the data controller for this data. We act as your processor under a Data Processing Agreement (DPA).</p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 space-y-1">
                <p className="font-semibold">Your responsibilities as data controller:</p>
                <ul className="list-disc ml-5 space-y-1 text-sm">
                  <li>Ensure respondents were informed how their data would be used</li>
                  <li>Obtain necessary consents or have another lawful basis for processing</li>
                  <li>Anonymise or pseudonymise personal data before uploading where possible</li>
                  <li>Do not upload special category data (health, ethnicity, religion) without appropriate safeguards</li>
                </ul>
              </div>
              <p>We process your survey data <strong>only to provide the analysis service</strong> you requested. We do not use your survey data to train AI models or for any other purpose.</p>
            </div>
          </section>

          {/* 6 */}
          <section id="section-6">
            <h2 className="text-xl font-bold mb-3">6. Third-party processors</h2>
            <div className="text-sm text-gray-700 space-y-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left font-semibold">Processor</th>
                    <th className="border p-2 text-left font-semibold">Purpose</th>
                    <th className="border p-2 text-left font-semibold">Data transferred</th>
                    <th className="border p-2 text-left font-semibold">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Supabase Inc.", "Database, authentication, file storage", "All platform data", "US/EU (selectable)"],
                    ["Google LLC (Gemini API)", "AI analysis planning, interpretation, report drafting", "Column names, aggregated statistics, project context — NOT raw respondent data", "US"],
                    ["Vercel Inc. (optional)", "Frontend hosting", "Request logs, IP addresses", "US/EU (Edge)"],
                  ].map(([processor, purpose, data, location]) => (
                    <tr key={processor}>
                      <td className="border p-2 font-medium">{processor}</td>
                      <td className="border p-2">{purpose}</td>
                      <td className="border p-2 text-gray-600">{data}</td>
                      <td className="border p-2 text-gray-600">{location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                <strong>AI data minimisation:</strong> When sending data to the Gemini API for analysis, we send only column names, statistical summaries (means, counts, distributions), and project metadata. We never send raw respondent-level rows to the AI.
              </div>
            </div>
          </section>

          {/* 7 */}
          <section id="section-7">
            <h2 className="text-xl font-bold mb-3">7. Data retention</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left font-semibold">Data type</th>
                    <th className="border p-2 text-left font-semibold">Retention period</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Account data", "For the life of the account + 30 days after deletion request"],
                    ["Survey datasets (uploaded files)", "Until project is deleted by the user, or account closure + 30 days"],
                    ["Analysis results and reports", "Same as survey datasets"],
                    ["Security logs (IP, timestamps)", "90 days"],
                    ["Error logs", "30 days"],
                  ].map(([type, period]) => (
                    <tr key={type}>
                      <td className="border p-2">{type}</td>
                      <td className="border p-2 text-gray-600">{period}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>You can delete individual projects (and their associated data) at any time from the dashboard. Account deletion requests are processed within 30 days.</p>
            </div>
          </section>

          {/* 8 */}
          <section id="section-8">
            <h2 className="text-xl font-bold mb-3">8. Your rights (GDPR)</h2>
            <div className="text-sm text-gray-700 space-y-3">
              <p>Under the UK and EU GDPR, you have the following rights regarding your personal data:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ["Right of access", "Request a copy of all personal data we hold about you"],
                  ["Right to rectification", "Correct inaccurate or incomplete personal data"],
                  ["Right to erasure", "Request deletion of your account and associated data"],
                  ["Right to data portability", "Receive your data in a machine-readable format (JSON/CSV)"],
                  ["Right to object", "Object to processing based on legitimate interests"],
                  ["Right to restrict processing", "Pause processing while a dispute is resolved"],
                  ["Right to withdraw consent", "Where processing is based on consent, withdraw it at any time"],
                  ["Right to lodge a complaint", "Contact your national data protection authority (e.g. ICO in the UK)"],
                ].map(([right, desc]) => (
                  <div key={right} className="rounded-lg border bg-white p-3">
                    <p className="text-xs font-semibold text-gray-800">{right}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
                  </div>
                ))}
              </div>
              <p>To exercise any of these rights, email <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a>. We will respond within 30 days.</p>
            </div>
          </section>

          {/* 9 */}
          <section id="section-9">
            <h2 className="text-xl font-bold mb-3">9. Cookies</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <p>We use the following cookies:</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left font-semibold">Cookie</th>
                    <th className="border p-2 text-left font-semibold">Purpose</th>
                    <th className="border p-2 text-left font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["sb-auth-token", "Supabase authentication session", "Session / 1 week"],
                    ["sb-refresh-token", "Supabase session refresh", "1 week"],
                  ].map(([cookie, purpose, duration]) => (
                    <tr key={cookie}>
                      <td className="border p-2 font-mono">{cookie}</td>
                      <td className="border p-2">{purpose}</td>
                      <td className="border p-2 text-gray-600">{duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>We do not use tracking, analytics, or advertising cookies. No third-party cookies are set without your consent.</p>
            </div>
          </section>

          {/* 10 */}
          <section id="section-10">
            <h2 className="text-xl font-bold mb-3">10. Changes to this policy</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <p>We may update this policy to reflect changes in our practices or legal requirements. When we do:</p>
              <ul className="list-disc ml-5 space-y-1">
                <li>We will update the "Last updated" date at the top of this page</li>
                <li>For material changes, we will notify registered users by email at least 14 days before the change takes effect</li>
                <li>Continued use of the platform after the effective date constitutes acceptance of the updated policy</li>
              </ul>
            </div>
          </section>

          {/* 11 */}
          <section id="section-11">
            <h2 className="text-xl font-bold mb-3">11. Contact us</h2>
            <div className="text-sm text-gray-700 space-y-2">
              <p>For any questions, concerns, or data subject requests related to this policy:</p>
              <div className="rounded-lg border bg-gray-50 p-4 space-y-1">
                <p><strong>Email:</strong> <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a></p>
                <p className="text-xs text-gray-500">We respond to all data protection queries within 5 business days, and to formal GDPR requests within 30 calendar days.</p>
              </div>
              <p className="text-xs text-gray-500 mt-4">
                If you are unsatisfied with our response, you have the right to lodge a complaint with your national supervisory authority. In the UK: <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Information Commissioner's Office (ICO)</a>.
              </p>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 border-t pt-8 text-center text-sm text-gray-500">
          <p>© {new Date().getFullYear()} SurveyAI Analyst · <Link href="/landing" className="text-blue-600 hover:underline">Home</Link> · <Link href="/setup" className="text-blue-600 hover:underline">Setup Guide</Link></p>
        </div>
      </div>
    </div>
  );
}
