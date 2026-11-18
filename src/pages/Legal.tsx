import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LEGAL, isPlaceholder } from "../lib/legal";

/** A detail from LEGAL; still-unfilled ones are highlighted so they are not missed. */
function V({ v }: { v: string }) {
  return isPlaceholder(v) ? <mark className="rounded bg-amber-100 px-1 text-amber-900">{v}</mark> : <>{v}</>;
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · IWILL Attend`;
    window.scrollTo(0, 0);
    return () => {
      document.title = "IWILL Attend";
    };
  }, [title]);
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/" aria-label="IWILL Attend home"><img src="/logo.png" alt="IWILL Attend" className="h-9 w-auto" /></Link>
          <nav className="flex gap-4 text-sm font-medium">
            <Link to="/privacy" className="text-slate-600 hover:text-brand-700">Privacy</Link>
            <Link to="/terms" className="text-slate-600 hover:text-brand-700">Terms</Link>
          </nav>
        </div>
      </header>
      <article className="legal mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed text-slate-700">
        <h1 className="text-3xl font-bold text-navy-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Effective {LEGAL.effective}</p>
        {children}
      </article>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} <V v={LEGAL.company} /> · <Link to="/privacy" className="hover:underline">Privacy Policy</Link> · <Link to="/terms" className="hover:underline">Terms of Service</Link>
      </footer>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="mb-3 mt-10 text-xl font-semibold text-navy-900">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-3">{children}</p>;
const UL = ({ children }: { children: ReactNode }) => <ul className="mt-3 list-disc space-y-1.5 pl-5">{children}</ul>;

function Contact() {
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-4 text-sm">
      <p><b><V v={LEGAL.company} /></b></p>
      <p><V v={LEGAL.address} /></p>
      <p>Email: <a href={`mailto:${LEGAL.email}`} className="font-medium text-brand-700 hover:underline">{LEGAL.email}</a></p>
      {LEGAL.grievanceName ? (
        <p className="mt-3"><b>Grievance Officer:</b> <V v={LEGAL.grievanceName} />, <V v={LEGAL.grievanceEmail} /></p>
      ) : (
        <p className="mt-3">For privacy requests and complaints, write to the email above with the subject "Privacy request".</p>
      )}
    </div>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy Policy">
      <P>
        IWILL Attend is an attendance, leave, payroll and asset management service run by <V v={LEGAL.company} /> ("we", "us").
        This policy explains what information the service handles, why, where it is kept, and the choices and rights you have.
        It is written to meet India's Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and its rules.
      </P>

      <H>1. Who is responsible for your data</H>
      <P>
        <b>Companies</b> (our customers) sign up and use IWILL Attend for their own staff. For the information about their employees,
        the company is the <b>data fiduciary</b>: it decides what to collect and why. We act as its <b>data processor</b> and handle that
        information only to provide the service, on the company's instructions.
      </P>
      <P>
        For the information about the company owner's own account (sign-up, plan and billing details), we are the data fiduciary.
      </P>
      <P>
        <b>If you are an employee</b>, please contact your employer first for questions about your attendance, salary or records.
        You can also contact us; we will pass your request to your employer or help directly where the law allows.
      </P>

      <H>2. Information we handle</H>
      <P><b>Account and company details</b></P>
      <UL>
        <li>Name, work email, phone number and password (stored only in scrambled, hashed form).</li>
        <li>Company name, address, city, state, GSTIN, branches and their map locations.</li>
      </UL>
      <P><b>Employee records</b> (entered by the employer)</P>
      <UL>
        <li>Employee code, designation, department, role, branch, shift, joining and exit dates.</li>
        <li>Salary structure, PF, ESI, professional tax and TDS settings, payslips, and, where the employer enters them, bank account number, IFSC, PAN and UAN.</li>
        <li>Leave, work-from-home, correction and overtime requests, and the decisions on them.</li>
      </UL>
      <P><b>Attendance and location</b></P>
      <UL>
        <li>The time of each check-in and check-out, and the phone's <b>location</b> and its accuracy at that moment. Location is read only when the person taps check-in, check-out or log visit; it is <b>not tracked in the background</b>.</li>
        <li>A <b>selfie</b> taken live by the phone's camera at each check-in, check-out and field visit.</li>
        <li>For field visits: client name and notes entered by the employee.</li>
      </UL>
      <P><b>Face recognition</b> (only if the employer switches it on)</P>
      <UL>
        <li>When an employee registers, a <b>face template</b> is made: a list of numbers describing the face, not a photo. It is created on the phone itself and only the numbers are sent to us.</li>
        <li>Each check-in selfie is compared with the template, and the result (matched or not) is recorded for the employer.</li>
        <li>Registration needs the employee's <b>explicit consent</b>, recorded with the date. An admin can delete the template at any time, and a mismatch never blocks attendance; it is only flagged to the manager.</li>
      </UL>
      <P><b>Documents and assets</b></P>
      <UL>
        <li>Files the company uploads (for example registration certificates, licences, vehicle RC books, insurance papers), their details and expiry dates, and which staff they are shared with or which assets staff hold.</li>
      </UL>
      <P><b>Technical information</b></P>
      <UL>
        <li>Sign-in session details kept in your browser so you stay signed in.</li>
        <li>Network (IP) address when you request a password reset code, used only to prevent abuse.</li>
        <li>Basic service logs kept by our hosting providers for security and fault finding.</li>
      </UL>

      <H>3. Why we use it</H>
      <UL>
        <li>To record attendance and confirm it is genuine (the selfie, location and optional face check).</li>
        <li>To work out leave, overtime, the monthly attendance sheet and salary, and to produce payslips and reports for the employer.</li>
        <li>To store company documents and remind the company before they expire.</li>
        <li>To run accounts, sign-in and password reset, and to send service emails such as reset codes.</li>
        <li>To keep the service secure, prevent misuse and fix problems.</li>
      </UL>
      <P>
        We do <b>not</b> sell personal data, show advertising, or use it to build profiles for marketing.
        We do not use employees' data for any purpose of our own.
      </P>

      <H>4. Legal basis and consent</H>
      <P>
        The employer is responsible for informing its staff and having a lawful basis, under section 7 of the Digital Personal Data
        Protection Act, 2023 (for example the purposes of employment), or their consent, for collecting attendance, location, selfie
        and payroll information. Face templates are collected only with the employee's explicit consent given on screen.
        By using the service, a company confirms that it has given its staff the notice this law requires.
      </P>

      <H>5. Who can see it</H>
      <UL>
        <li><b>Within a company:</b> an employee sees their own records. Owners, admins, HR and managers of that company see their company's records, as described on the roles page in the app. One company can never see another company's data.</li>
        <li><b>Our team:</b> only to provide support or fix a problem, or when the law requires it.</li>
        <li><b>Service providers</b> who store or move the data for us, under contract, and only for running IWILL Attend:
          <UL>
            <li><b>Supabase</b>: database and sign-in, hosted in Mumbai, India.</li>
            <li><b>Cloudflare</b>: website hosting and private storage of selfies and documents (Asia-Pacific region).</li>
            <li><b>Resend</b>: sending service emails such as password reset codes (your email address and the email content).</li>
            <li><b>OpenStreetMap</b>: map images on screens that show a map, loaded by your browser.</li>
          </UL>
          Some of these providers may process data outside India, in countries not restricted by the Government of India.
        </li>
        <li><b>Authorities</b>, when required by law or a valid legal order.</li>
      </UL>

      <H>6. How long we keep it</H>
      <UL>
        <li>We keep a company's data while its account is active, so it can see past attendance, payroll and documents.</li>
        <li>The company can delete employee records, documents and face templates it no longer needs.</li>
        <li>When a company closes its account, we delete its data within 90 days, except where the law requires us to keep something longer (for example tax and payroll records).</li>
        <li>Password reset codes are deleted within a day.</li>
      </UL>

      <H>7. How we protect it</H>
      <UL>
        <li>All traffic is encrypted (HTTPS).</li>
        <li>Each company's data is kept separate by rules in the database itself, not only in the app.</li>
        <li>Selfies and documents are stored privately and can be opened only by people with permission, through short-lived checks.</li>
        <li>Passwords and reset codes are stored only in hashed form.</li>
      </UL>
      <P>
        No system is perfectly secure. If a personal data breach happens, we will inform the affected company and, where the law
        requires, the Data Protection Board of India and the people affected.
      </P>

      <H>8. Your rights</H>
      <P>Under the Digital Personal Data Protection Act, 2023 you can:</P>
      <UL>
        <li>ask for a summary of your personal data and how it is used;</li>
        <li>ask for wrong or incomplete data to be corrected or completed;</li>
        <li>ask for data to be deleted when it is no longer needed, unless the law requires it to be kept;</li>
        <li>withdraw a consent you gave (for example for face recognition); this does not affect what was done before;</li>
        <li>nominate another person to exercise these rights if you die or cannot do so yourself;</li>
        <li>raise a grievance with us, and, if not resolved, complain to the Data Protection Board of India.</li>
      </UL>
      <P>
        Employees should send requests about their work records to their employer. You can also write to us at the contact
        below; we aim to reply within 30 days.
      </P>

      <H>9. Children</H>
      <P>IWILL Attend is meant for workplaces and is not intended for anyone under 18. We do not knowingly collect children's data.</P>

      <H>10. Cookies and browser storage</H>
      <P>
        We do not use advertising or tracking cookies. The app stores your sign-in session in your browser so you stay signed in;
        signing out removes it.
      </P>

      <H>11. Changes to this policy</H>
      <P>
        We may update this policy as the service or the law changes. We will change the date at the top and, for important changes,
        tell company owners by email or in the app before they take effect.
      </P>

      <H>12. Contact and grievances</H>
      <Contact />
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of Service">
      <P>
        These terms are an agreement between <V v={LEGAL.company} /> ("we", "us") and the company or person who registers for
        IWILL Attend ("you", "the customer"). By creating an account or using the service you agree to them. If you register on
        behalf of a business, you confirm that you are allowed to accept these terms for it.
      </P>

      <H>1. The service</H>
      <P>
        IWILL Attend is an online service for selfie and location based attendance, field visits, leave, shifts, overtime, payroll
        calculation, payslips, and company documents and assets. It works in a web browser; features available depend on your plan.
      </P>

      <H>2. Accounts</H>
      <UL>
        <li>The person who registers becomes the company <b>owner</b> and can add admins, HR, managers and employees.</li>
        <li>You are responsible for everything done under your company's logins. Keep passwords private and tell us at once if you believe an account was misused.</li>
        <li>Information you give us must be true and kept up to date.</li>
      </UL>

      <H>3. Your responsibilities towards your staff</H>
      <UL>
        <li>Before using the service for any employee, you must tell them what is collected (attendance times, location at check-in, selfies, and face templates if switched on) and why, and have a lawful basis or their consent as Indian law requires.</li>
        <li>You must use the data only for managing work, attendance and pay, and not to watch employees outside work or for any unlawful purpose.</li>
        <li>You must not make face registration a condition of employment where the law does not allow it, and you must delete templates on request when required.</li>
        <li>You are responsible for the accuracy of what you enter, such as salaries, rules, holidays and bank details.</li>
      </UL>

      <H>4. Payroll and calculations</H>
      <P>
        The service calculates attendance, pay, PF, ESI, professional tax and TDS from the rules and figures you set. These are tools
        to help you, <b>not legal, tax or accounting advice</b>. You must check the results and remain responsible for paying your
        staff correctly and meeting labour, tax and statutory obligations.
      </P>

      <H>5. Plans, trial and payment</H>
      <UL>
        <li>Plans differ by number of employees, features and document storage, as shown on the Plans page.</li>
        <li>Paid plans start with a 14-day free trial. When it ends without payment, the account moves to the Free plan.</li>
        <li>Prices are in Indian rupees and may change; we will give at least 30 days' notice of a price change for an active plan.</li>
        <li>If you have more active employees than your plan allows for more than 7 days, attendance is paused until you upgrade or deactivate staff.</li>
        <li>Fees already paid are not refundable, except where the law requires a refund.</li>
      </UL>

      <H>6. Acceptable use</H>
      <P>You must not:</P>
      <UL>
        <li>use the service against the law, or to collect data about people without telling them;</li>
        <li>upload anything unlawful, harmful, or that you have no right to share;</li>
        <li>try to get into other companies' data, break the service's security, or overload it;</li>
        <li>fake attendance, for example by using photos of photos or false locations, or help others do so;</li>
        <li>copy, resell or reverse-engineer the service.</li>
      </UL>

      <H>7. Your data</H>
      <UL>
        <li>Your company's data belongs to you. We use it only to provide the service, as our <Link to="/privacy" className="font-medium text-brand-700 hover:underline">Privacy Policy</Link> explains.</li>
        <li>You can download reports and attendance records from the app while your account is active.</li>
        <li>After an account is closed, we delete its data within 90 days, except what the law requires us to keep.</li>
      </UL>

      <H>8. Availability and changes</H>
      <P>
        We work to keep the service running and secure, but we do not promise it will always be available or free of errors. We may
        improve, change or remove features; if we remove an important paid feature, we will tell you in advance.
      </P>

      <H>9. Suspension and closing</H>
      <UL>
        <li>You can stop using the service at any time and ask us to close your account.</li>
        <li>We may suspend or close an account that breaks these terms, fails to pay, or puts the service or others at risk. Where reasonable we will warn you first and give you time to download your records.</li>
      </UL>

      <H>10. Liability</H>
      <P>
        To the extent the law allows, the service is provided "as is". We are not liable for indirect or consequential loss, such as
        lost profit, or for decisions you make based on the service's records or calculations. Our total liability for any claim is
        limited to the fees you paid us in the 12 months before the claim. Nothing in these terms limits liability that cannot be
        limited under Indian law.
      </P>

      <H>11. Indemnity</H>
      <P>
        You agree to compensate us for claims made by your employees or others arising from your use of the service in breach of
        these terms or the law, including failing to inform or obtain consent from your staff.
      </P>

      <H>12. Governing law and disputes</H>
      <P>
        These terms are governed by the laws of India. Disputes will be handled by the courts at <V v={LEGAL.courtsCity} />, Kerala.
        Before going to court, both sides will first try to settle the matter by talking in good faith for 30 days.
      </P>

      <H>13. Changes to these terms</H>
      <P>
        We may update these terms. We will change the date at the top and tell company owners about important changes before they
        take effect. Continuing to use the service after that means you accept the new terms.
      </P>

      <H>14. Contact</H>
      <Contact />
    </Page>
  );
}
