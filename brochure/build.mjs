// Builds the IWILL Attend client brochure as two A4 HTML files (8 pages and a 4-page short one).
// Run: node brochure/build.mjs   then print each HTML to PDF (see brochure/make-pdf.sh).
import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as L from "lucide-react";

const dir = new URL(".", import.meta.url);
const logo = "../public/logo.png";
const SITE = "www.iwillattend.in";

const ic = (name, size = 26, color = "currentColor", stroke = 2) =>
  renderToStaticMarkup(createElement(L[name], { size, color, strokeWidth: stroke }));

// ---------- small building blocks ----------
const footer = (n) => `<footer><img src="${logo}" alt=""><span>${SITE}</span><b>${String(n).padStart(2, "0")}</b></footer>`;

const head = (kicker, title, lead = "") => `
  <p class="kicker">${kicker}</p>
  <h1>${title}</h1>
  ${lead ? `<p class="lead">${lead}</p>` : ""}`;

const card = (icon, title, text, tone = "teal") => `
  <div class="card">
    <span class="ico ${tone}">${ic(icon, 24)}</span>
    <h3>${title}</h3>
    <p>${text}</p>
  </div>`;

const badge = (text, tone) => `<span class="badge ${tone}">${text}</span>`;

const phone = (inner) => `<div class="phone"><div class="notch"></div><div class="screen">${inner}</div></div>`;

const checkinScreen = `
  <p class="ph-hello">Hello, Anu</p>
  <p class="ph-date">Monday, 16 November</p>
  <div class="ph-card">
    <div class="ph-face">${ic("UserRound", 40, "#04837f", 1.8)}<i>${ic("Check", 12, "#fff", 3.5)}</i></div>
    <p class="ph-big">Checked in</p>
    <p class="ph-time">9:02 AM</p>
    <div class="ph-badges">${badge("On time", "g")}${badge("Face matched", "g")}${badge("At office · 12 m", "t")}</div>
    <div class="ph-btn">${ic("LogOut", 14, "#fff")} Check out</div>
  </div>
  <div class="ph-nav"><span class="on">${ic("Fingerprint", 16)}Attendance</span><span>${ic("CalendarClock", 16)}History</span><span>${ic("Palmtree", 16)}Leave</span><span>${ic("ReceiptText", 16)}Payslips</span></div>`;

const cameraScreen = `
  <p class="ph-hello">Check in</p>
  <p class="ph-date">Look at the camera</p>
  <div class="ph-cam"><div class="ph-ring">${ic("UserRound", 62, "#ffffff", 1.4)}</div></div>
  <div class="ph-loc">${ic("MapPin", 14, "#04837f")} Location found · within 9 m</div>
  <div class="ph-btn green">${ic("Camera", 14, "#fff")} Take selfie</div>`;

const person = (name, type, time, tags) => `
  <tr><td><span class="av">${name[0]}</span><b>${name}</b><small>${type}</small></td><td>${time}</td><td>${tags}</td></tr>`;

const dashboardRows = [
  person("Anu Thomas", "Office staff", "9:02 AM", badge("On time", "g") + badge("At office", "t")),
  person("Fathima K", "Office staff", "9:41 AM", badge("Late 26 min", "a") + badge("At office", "t")),
  person("Rahul Nair", "Field staff", "9:10 AM", badge("On time", "g") + badge("Field", "s")),
  person("Joseph Mathew", "Office staff", "8:55 AM", badge("On time", "g") + badge("Site work · City Mall", "t")),
];
const dashboard = (rows = 4) => `
  <div class="dash">
    <div class="dash-top"><b>Dashboard</b><span>Today</span></div>
    <div class="tiles">
      <div><small>Active staff</small><b>24</b></div>
      <div><small>Checked in</small><b class="g">21</b></div>
      <div><small>Not in yet</small><b class="r">3</b></div>
      <div><small>Late</small><b class="a">2</b></div>
    </div>
    <table>
      <tr><th>Employee</th><th>In</th><th>Status</th></tr>
      ${dashboardRows.slice(0, rows).join("")}
    </table>
  </div>`;

const payslip = `
  <div class="slip">
    <div class="slip-top"><b>Payslip · October 2026</b><span>Anu Thomas</span></div>
    <div class="slip-rows">
      <p><span>Days paid</span><b>25 of 26</b></p>
      <p><span>Basic + allowances</span><b>₹ 24,038</b></p>
      <p><span>Overtime (6 h)</span><b>₹ 1,125</b></p>
      <p><span>PF and ESI</span><b>− ₹ 1,920</b></p>
      <p><span>Professional tax</span><b>− ₹ 200</b></p>
    </div>
    <div class="slip-net"><span>Net pay</span><b>₹ 23,043</b></div>
    <p class="slip-note">Sample figures for illustration</p>
  </div>`;

const tick = (text) => `<li>${ic("CircleCheck", 18, "#33a101")}<span>${text}</span></li>`;

// ---------- pages ----------
const cover = () => `
<section class="page cover">
  <div class="cover-top">
    <img class="cover-logo" src="${logo}" alt="IWILL Attend">
    <p class="cover-tag">Selfie + location attendance, with payroll</p>
  </div>
  <div class="cover-mid">
    <div class="cover-text">
      <h1>Attendance you can trust.<br><em>Payroll that follows.</em></h1>
      <p>Your staff mark attendance with a selfie on their own phone. You see who came, when and from where, and salary is worked out for you.</p>
      <ul class="cover-points">
        <li>${ic("Smartphone", 20)} Works on any phone. No app to install.</li>
        <li>${ic("Fingerprint", 20)} No attendance machine to buy.</li>
        <li>${ic("Timer", 20)} Ready to use in about 10 minutes.</li>
      </ul>
    </div>
    ${phone(checkinScreen)}
  </div>
  <div class="cover-foot"><span>For shops, offices, clinics, contractors and field teams</span><b>${SITE}</b></div>
</section>`;

const problems = (n) => `
<section class="page">
  ${head("The problem", "Does this happen in your business?", "Most owners lose money and time on attendance without noticing. These are the five problems we hear most.")}
  <div class="pains">
    ${[
      ["Users", "One person marks attendance for a friend", "With a register or a punch card, anyone can sign for someone who has not come."],
      ["MapPinOff", "“I was at the client's place, sir”", "You have no way to check whether field staff really went where they said."],
      ["FileSpreadsheet", "Registers and Excel sheets full of mistakes", "Late marks, half days and leave are counted by hand, and errors creep in."],
      ["MessagesSquare", "Arguments on salary day", "Staff and owner remember the month differently, and there is no clear record to settle it."],
      ["Clock", "Hours lost every month end", "Someone spends days adding up attendance before salary can even be worked out."],
    ].map(([i, t, d], k) => `<div class="pain"><span class="num">${k + 1}</span><span class="ico red">${ic(i, 24)}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join("")}
  </div>
  <div class="band">
    ${ic("ShieldCheck", 34, "#fff")}
    <p><b>IWILL Attend solves all five</b> using only the phone your staff already carry.</p>
  </div>
  ${footer(n)}
</section>`;

const how = (n) => `
<section class="page">
  ${head("How it works", "Three simple steps", "If your staff can take a selfie, they can use IWILL Attend.")}
  <div class="how">
    <div class="steps">
      ${[
        ["Staff open the website on their phone", "They sign in once with the login you give them. Nothing to download from any app store."],
        ["They take a selfie to check in and check out", "The phone records the time and the place at the same moment. Office staff must be at the office; field staff can check in from where they work."],
        ["You see everything, live", "Open your dashboard on a phone or computer: who is in, who is late, who is on leave, and where each person checked in, on a map."],
      ].map(([t, d], k) => `<div class="step"><span>${k + 1}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join("")}
    </div>
    ${phone(cameraScreen)}
  </div>
  <h2 class="sub">What the owner sees</h2>
  ${dashboard(4)}
  ${footer(n)}
</section>`;

const attendance = (n) => `
<section class="page">
  ${head("Attendance", "Know who came, when and from where", "Every check-in carries three proofs: a photo, a time and a place.")}
  <div class="grid2">
    ${card("Camera", "Selfie at check-in and check-out", "A live photo is taken each time. Photos from the gallery cannot be used.")}
    ${card("MapPin", "Office boundary", "You mark your office on a map and set a distance. Office staff can check in only inside it.")}
    ${card("ScanFace", "Face match", "The selfie is compared with the employee's registered face. A mismatch is flagged to the manager.", "green")}
    ${card("MapPinned", "Made for field staff", "Sales and service staff check in from anywhere and log each client visit with a selfie and location.", "green")}
    ${card("HardHat", "Site work allotment", "Sending someone to a client site or project? Allot it, and on those days they can check in from the site.", "navy")}
    ${card("House", "Work from home requests", "Staff ask, you approve. On approved days they check in from home, still with a selfie.", "navy")}
  </div>
  <div class="note">
    ${ic("Lock", 22, "#04837f")}
    <p><b>Private by design.</b> Each company's data is kept separate. Selfies are stored privately and can be seen only by the employee and that company's managers.</p>
  </div>
  ${footer(n)}
</section>`;

const rules = (n) => `
<section class="page">
  ${head("Leave, shifts and rules", "Your rules, applied the same way to everyone", "You set the rules once. The system follows them every day, so nobody can say they were treated unfairly.")}
  <div class="grid2 tight">
    ${card("AlarmClock", "Shifts and late marks", "Set shift timings and a grace time. Late arrivals are marked by themselves, to the minute.")}
    ${card("Palmtree", "Leave on the phone", "Staff apply for leave from their phone and see their balance. You approve or reject with one tap.", "green")}
    ${card("CalendarDays", "Holidays and weekly offs", "Add your holiday list and weekly offs, including 2nd and 4th Saturdays.", "navy")}
    ${card("TrendingUp", "Overtime", "Extra hours are counted for you. Pay them at 1.5x, 2x, a fixed amount, or a different rate for each employee.")}
  </div>
  <h2 class="sub">Full day, half day or absent? You choose how hours count</h2>
  <table class="rules">
    <tr><th></th><th>Strict</th><th>Pay by hours</th><th>Lenient</th></tr>
    <tr><td>Best for</td><td>Fixed monthly salary with firm timings</td><td>Shops and sites that pay for time worked</td><td>Teams with flexible timings</td></tr>
    <tr><td>Worked the full hours</td><td>Full day</td><td>Full day</td><td>Full day, even if up to 30 minutes short</td></tr>
    <tr><td>Worked more than half</td><td>Half day</td><td>Paid for the hours worked</td><td>Half day</td></tr>
    <tr><td>Worked less than half</td><td>Counted as absent</td><td>Paid for the hours worked</td><td>Half day</td></tr>
  </table>
  <p class="small">Example: with an 8-hour day, an employee who works 3 hours gets nothing under Strict, 3 hours' pay under Pay by hours, and a half day under Lenient. You decide the full-day and half-day hours.</p>
  ${footer(n)}
</section>`;

const payroll = (n) => `
<section class="page">
  ${head("Payroll", "Salary day without the headache", "Because attendance is already in the system, salary is worked out from it. No copying into Excel.")}
  <div class="flow">
    <div>${ic("Fingerprint", 30, "#04837f")}<b>Attendance</b><small>Days, late marks, leave, overtime</small></div>
    <i>${ic("ArrowRight", 26, "#94a3b8")}</i>
    <div>${ic("Calculator", 30, "#04837f")}<b>Salary worked out</b><small>With deductions</small></div>
    <i>${ic("ArrowRight", 26, "#94a3b8")}</i>
    <div>${ic("ReceiptText", 30, "#04837f")}<b>Payslips</b><small>On each employee's phone</small></div>
  </div>
  <div class="split">
    <ul class="ticks">
      ${tick("<b>Pay follows attendance.</b> Absent days, half days and unpaid leave are deducted by the system.")}
      ${tick("<b>Indian deductions built in:</b> PF, ESI, professional tax and TDS.")}
      ${tick("<b>Overtime and bonus</b> are added to the same payslip.")}
      ${tick("<b>Payslips for every employee,</b> to view on the phone or print.")}
      ${tick("<b>Bank transfer sheet</b> ready to give to your bank.")}
      ${tick("<b>Month lock.</b> Once salary is final, that month's attendance cannot be changed quietly.")}
    </ul>
    ${payslip}
  </div>
  <div class="note">
    ${ic("FileBarChart", 22, "#04837f")}
    <p><b>Reports in one click.</b> A monthly attendance sheet for all staff, and attendance reports you can download for your accountant.</p>
  </div>
  ${footer(n)}
</section>`;

const why = (n) => `
<section class="page">
  ${head("Why owners choose it", "What changes in your business")}
  <table class="ba">
    <tr><th>Today</th><th>With IWILL Attend</th></tr>
    ${[
      ["Anyone can sign the register for a friend", "Each check-in has that person's own selfie, time and place"],
      ["You trust what field staff tell you", "You see each visit on a map, with a photo"],
      ["Days of counting at month end", "The monthly sheet is ready the moment the month ends"],
      ["Salary worked out by hand in Excel", "Salary and payslips come from the attendance"],
      ["Disputes with no record to check", "A clear record both sides can see"],
      ["A costly biometric machine in one place", "Nothing to buy. Works at every branch and site"],
    ].map(([a, b]) => `<tr><td>${ic("X", 16, "#e11d48", 3)}<span>${a}</span></td><td>${ic("Check", 16, "#33a101", 3)}<span>${b}</span></td></tr>`).join("")}
  </table>
  <h2 class="sub">Who is it for?</h2>
  <div class="who">
    ${[["Store", "Shops and showrooms"], ["Building2", "Offices"], ["Stethoscope", "Clinics and labs"], ["HardHat", "Contractors and site teams"], ["Briefcase", "Sales and service teams"], ["GraduationCap", "Schools and institutes"]]
      .map(([i, t]) => `<div>${ic(i, 26, "#04837f")}<span>${t}</span></div>`).join("")}
  </div>
  <div class="grid3">
    <div class="fact"><b>5 to 500</b><span>employees, one system</span></div>
    <div class="fact"><b>Any phone</b><span>Android or iPhone, in the browser</span></div>
    <div class="fact"><b>Many branches</b><span>each with its own office boundary</span></div>
  </div>
  ${footer(n)}
</section>`;

const plan = (name, price, staff, best, featured) => `
  <div class="plan ${featured ? "featured" : ""}">
    ${featured ? `<span class="pop">Most popular</span>` : ""}
    <h3>${name}</h3>
    <p class="price">₹${price}<small> / month</small></p>
    <p class="staff">Up to <b>${staff}</b> employees</p>
    <ul>
      <li>${ic("Check", 15, "#33a101", 3)} Selfie + location attendance</li>
      <li>${ic("Check", 15, "#33a101", 3)} Field visits, shifts and leave</li>
      <li>${ic("Check", 15, "#33a101", 3)} Payroll and payslips</li>
      <li>${ic("Check", 15, "#33a101", 3)} Face match</li>
    </ul>
    <p class="best">${best}</p>
  </div>`;

const plans = (n) => `
<section class="page">
  ${head("Plans", "Simple pricing. Start free.", "Every plan has every feature. You pay only for the size of your team.")}
  <div class="plans">
    ${plan("Free", "0", "5", "For a small shop or a trial run")}
    ${plan("Standard", "999", "50", "For most shops, offices and clinics", true)}
    ${plan("Premium", "2,499", "500", "For larger teams and many branches")}
  </div>
  <p class="trial">${ic("Gift", 20, "#04837f")}<span>Paid plans start with a <b>14-day free trial</b>. No card needed.</span></p>
  <h2 class="sub">Start in about 10 minutes</h2>
  <div class="start">
    ${["Register your company on the website", "Mark your office on the map", "Add your staff and give them their login", "Staff check in with a selfie"].map((t, k) => `<div><span>${k + 1}</span><p>${t}</p></div>`).join("")}
  </div>
  <div class="cta">
    <div>
      <p class="cta-small">Try it today</p>
      <p class="cta-big">${SITE}</p>
      <p class="cta-small">Open this address on your phone or computer and tap “Start free”.</p>
    </div>
    <img src="${logo}" alt="IWILL Attend">
  </div>
  ${footer(n)}
</section>`;

// ---------- short version pages ----------
const shortHow = (n) => `
<section class="page">
  ${head("How it works", "Attendance by selfie, in three steps", "No register, no punch card, no machine. Only the phone your staff already carry.")}
  <div class="how">
    <div class="steps">
      ${[
        ["Staff open the website on their phone", "They sign in with the login you give them. Nothing to install."],
        ["They take a selfie to check in and out", "The time and the place are recorded with the photo."],
        ["You see everything, live", "Who is in, who is late, who is on leave, and where each person checked in."],
      ].map(([t, d], k) => `<div class="step"><span>${k + 1}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join("")}
    </div>
    ${phone(cameraScreen)}
  </div>
  <h2 class="sub">Problems it ends</h2>
  <div class="who four">
    ${[["Users", "Attendance marked for a friend"], ["MapPinOff", "Unchecked field visits"], ["FileSpreadsheet", "Register and Excel mistakes"], ["MessagesSquare", "Salary day arguments"]]
      .map(([i, t]) => `<div>${ic(i, 26, "#e11d48")}<span>${t}</span></div>`).join("")}
  </div>
  <h2 class="sub">What the owner sees</h2>
  ${dashboard(2)}
  ${footer(n)}
</section>`;

const shortFeatures = (n) => `
<section class="page">
  ${head("Features", "Everything from check-in to payslip")}
  <div class="grid2 tight">
    ${card("Camera", "Selfie + location check-in", "A live photo, the time and the place, every time.")}
    ${card("MapPin", "Office boundary", "Office staff can check in only at the office.")}
    ${card("ScanFace", "Face match", "A selfie that does not match is flagged to the manager.", "green")}
    ${card("MapPinned", "Field staff and site work", "Check in from the field, log client visits, allot site work.", "green")}
    ${card("Palmtree", "Leave, shifts and holidays", "Leave requests, late marks, weekly offs and holidays.", "navy")}
    ${card("TrendingUp", "Your day rules and overtime", "Choose how full day, half day and overtime are counted.", "navy")}
    ${card("Calculator", "Payroll and payslips", "Salary from attendance, with PF, ESI, professional tax and TDS. Payslips on the phone.")}
    ${card("Lock", "Private and safe", "Each company's data is kept separate. Selfies are stored privately.")}
  </div>
  <table class="ba compact">
    <tr><th>Today</th><th>With IWILL Attend</th></tr>
    ${[
      ["Days of counting at month end", "The monthly sheet is ready when the month ends"],
      ["Disputes with no record to check", "A clear record both sides can see"],
      ["A costly machine in one place", "Nothing to buy. Works at every branch and site"],
    ].map(([a, b]) => `<tr><td>${ic("X", 16, "#e11d48", 3)}<span>${a}</span></td><td>${ic("Check", 16, "#33a101", 3)}<span>${b}</span></td></tr>`).join("")}
  </table>
  ${footer(n)}
</section>`;

// ---------- styles ----------
const css = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #0c2e52; font-size: 11.5pt; line-height: 1.45; background: #cbd5e1; }
.page { width: 210mm; height: 297mm; padding: 17mm 17mm 20mm; position: relative; overflow: hidden; background: #fff; page-break-after: always; break-after: page; margin: 0 auto; }
svg { flex: none; }
.kicker { color: #04837f; font-weight: 700; font-size: 10pt; letter-spacing: .14em; text-transform: uppercase; }
h1 { font-size: 27pt; line-height: 1.15; font-weight: 800; margin: 2mm 0 3mm; letter-spacing: -.01em; }
.lead { font-size: 12.5pt; color: #475569; max-width: 160mm; margin-bottom: 7mm; }
h2.sub { font-size: 14pt; font-weight: 700; margin: 7mm 0 3.5mm; }
h3 { font-size: 12.5pt; font-weight: 700; line-height: 1.25; }
p { color: #334155; }
.small { font-size: 10pt; color: #64748b; margin-top: 3mm; }
footer { position: absolute; left: 17mm; right: 17mm; bottom: 9mm; display: flex; align-items: center; gap: 4mm; border-top: .3mm solid #e2e8f0; padding-top: 3mm; font-size: 9pt; color: #64748b; }
footer img { height: 6mm; } footer span { flex: 1; text-align: right; } footer b { color: #04837f; font-size: 10pt; }

.ico { display: inline-grid; place-items: center; width: 12mm; height: 12mm; border-radius: 3.2mm; flex: none; }
.ico.teal { background: #e0f5f4; color: #04837f; } .ico.green { background: #e8f6df; color: #2a8204; } .ico.navy { background: #e3e9f1; color: #0c2e52; } .ico.red { background: #ffe9ec; color: #e11d48; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.grid2.tight { gap: 3.5mm; } .grid2.tight .card { padding: 4mm 5mm; } .grid2.tight .card h3 { margin-top: 2mm; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-top: 7mm; }
.card { border: .3mm solid #e2e8f0; border-radius: 4mm; padding: 5.5mm 6mm; background: #fff; }
.card h3 { margin: 3mm 0 1.2mm; } .card p { font-size: 11pt; }
.note { display: flex; gap: 4mm; align-items: flex-start; background: #f0faf9; border: .3mm solid #bfe8e6; border-radius: 4mm; padding: 4.5mm 5.5mm; margin-top: 7mm; }
.note p { font-size: 11pt; }
.badge { display: inline-block; font-size: 7.4pt; font-weight: 600; padding: .5mm 2.2mm; border-radius: 10mm; margin: .4mm .6mm .4mm 0; white-space: nowrap; }
.badge.g { background: #e8f6df; color: #2a8204; } .badge.t { background: #e0f5f4; color: #04837f; } .badge.a { background: #fef3c7; color: #b45309; } .badge.s { background: #eef2f6; color: #475569; }

/* cover */
.cover { padding: 0; display: flex; flex-direction: column; background: linear-gradient(180deg, #fff 0, #fff 46%, #f0faf9 100%); }
.cover-top { padding: 20mm 20mm 0; } .cover-logo { height: 23mm; }
.cover-tag { margin-top: 5mm; color: #04837f; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: 10.5pt; }
.cover-mid { flex: 1; display: flex; align-items: center; gap: 8mm; padding: 0 20mm; }
.cover-text h1 { font-size: 35pt; line-height: 1.1; margin-bottom: 6mm; } .cover-text h1 em { font-style: normal; color: #04837f; }
.cover-text p { font-size: 13.5pt; color: #475569; }
.cover-points { list-style: none; margin-top: 8mm; } .cover-points li { display: flex; align-items: center; gap: 3.5mm; font-weight: 600; font-size: 12pt; margin-bottom: 3.5mm; } .cover-points svg { color: #04837f; }
.cover-foot { background: #0c2e52; color: #fff; padding: 9mm 20mm; display: flex; justify-content: space-between; align-items: center; font-size: 11pt; } .cover-foot b { font-size: 15pt; color: #7fe3df; }

/* phone */
.phone { width: 62mm; flex: none; border: 2.4mm solid #0c2e52; border-radius: 9mm; background: #0c2e52; position: relative; box-shadow: 0 6mm 14mm rgba(12,46,82,.22); }
.notch { position: absolute; top: 1.2mm; left: 50%; width: 16mm; height: 3mm; margin-left: -8mm; background: #0c2e52; border-radius: 3mm; z-index: 2; }
.screen { background: #f8fafc; border-radius: 6.6mm; padding: 8mm 4mm 3mm; min-height: 112mm; display: flex; flex-direction: column; }
.ph-hello { font-weight: 700; font-size: 11pt; color: #0c2e52; } .ph-date { font-size: 8pt; color: #64748b; margin-bottom: 3mm; }
.ph-card { background: #fff; border: .25mm solid #e2e8f0; border-radius: 3.5mm; padding: 4.5mm 3mm; text-align: center; }
.ph-face { width: 17mm; height: 17mm; border-radius: 50%; background: #e0f5f4; display: grid; place-items: center; margin: 0 auto 2.5mm; position: relative; }
.ph-face i { position: absolute; right: -.5mm; bottom: -.5mm; width: 5.2mm; height: 5.2mm; border-radius: 50%; background: #33a101; display: grid; place-items: center; border: .5mm solid #fff; }
.ph-big { font-weight: 700; font-size: 10.5pt; color: #0c2e52; } .ph-time { font-size: 15pt; font-weight: 800; color: #04837f; margin-bottom: 2mm; }
.ph-badges { margin-bottom: 3.5mm; }
.ph-btn { background: #e11d48; color: #fff; font-weight: 600; font-size: 9pt; border-radius: 2.5mm; padding: 2.4mm; display: flex; justify-content: center; align-items: center; gap: 1.5mm; }
.ph-btn.green { background: #2a8204; margin-top: auto; }
.ph-nav { margin-top: auto; display: flex; justify-content: space-between; border-top: .25mm solid #e2e8f0; padding-top: 2mm; }
.ph-nav span { display: flex; flex-direction: column; align-items: center; font-size: 5.8pt; color: #64748b; gap: .5mm; } .ph-nav .on { color: #04837f; font-weight: 700; }
.ph-cam { background: #0c2e52; border-radius: 3.5mm; height: 62mm; display: grid; place-items: center; margin-bottom: 3mm; }
.ph-ring { width: 40mm; height: 48mm; border: .8mm dashed #33d6a0; border-radius: 50%; display: grid; place-items: center; }
.how .screen { min-height: 0; } .how .ph-cam { height: 44mm; } .how .ph-ring { width: 30mm; height: 36mm; } .how .ph-ring svg { width: 46px; height: 46px; }
.how + h2.sub { margin-top: 5mm; }
.ph-loc { display: flex; align-items: center; gap: 1.5mm; font-size: 7.6pt; color: #04837f; font-weight: 600; background: #e0f5f4; border-radius: 2.5mm; padding: 2mm 2.5mm; margin-bottom: 3mm; }

/* problems */
.pains { display: grid; gap: 4mm; }
.pain { display: flex; align-items: center; gap: 5mm; border: .3mm solid #e2e8f0; border-radius: 4mm; padding: 4.5mm 6mm; }
.pain .num { font-size: 20pt; font-weight: 800; color: #cbd5e1; width: 8mm; } .pain p { font-size: 11pt; margin-top: .8mm; }
.band { margin-top: 8mm; background: linear-gradient(100deg, #04837f, #0c2e52); border-radius: 5mm; padding: 7mm 8mm; display: flex; align-items: center; gap: 6mm; }
.band p { color: #fff; font-size: 14pt; line-height: 1.35; } .band b { color: #b8f4c8; }

/* how */
.how { display: flex; gap: 9mm; align-items: center; }
.steps { flex: 1; display: grid; gap: 6mm; }
.step { display: flex; gap: 5mm; } .step > span { flex: none; width: 11mm; height: 11mm; border-radius: 50%; background: #04837f; color: #fff; font-weight: 800; font-size: 14pt; display: grid; place-items: center; }
.step p { font-size: 11pt; margin-top: 1mm; }
.dash { border: .3mm solid #e2e8f0; border-radius: 4mm; overflow: hidden; }
.dash-top { background: #0c2e52; color: #fff; display: flex; justify-content: space-between; padding: 2.6mm 5mm; font-size: 10pt; } .dash-top span { color: #9fd9d6; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; padding: 3.5mm 5mm; background: #f8fafc; }
.tiles div { background: #fff; border: .25mm solid #e2e8f0; border-radius: 2.5mm; padding: 2mm 3mm; } .tiles small { display: block; font-size: 8pt; color: #64748b; } .tiles b { font-size: 15pt; }
.tiles .g { color: #2a8204; } .tiles .r { color: #e11d48; } .tiles .a { color: #d97706; }
.dash table { width: 100%; border-collapse: collapse; font-size: 9.5pt; } .dash th { text-align: left; font-size: 8pt; color: #64748b; font-weight: 600; padding: 1.8mm 5mm; background: #f8fafc; border-top: .25mm solid #e2e8f0; }
.dash td { padding: 2mm 5mm; border-top: .25mm solid #eef2f6; vertical-align: middle; } .dash td small { display: block; font-size: 7.6pt; color: #64748b; margin-left: 9mm; margin-top: -1mm; }
.av { display: inline-grid; place-items: center; width: 7mm; height: 7mm; border-radius: 50%; background: #e0f5f4; color: #04837f; font-weight: 700; font-size: 9pt; margin-right: 2mm; vertical-align: middle; }

/* rules table */
table.rules { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 10.3pt; border: .3mm solid #e2e8f0; border-radius: 4mm; overflow: hidden; }
.rules th { background: #0c2e52; color: #fff; padding: 3mm 4mm; text-align: left; font-size: 11pt; } .rules th:nth-child(3) { background: #04837f; }
.rules td { padding: 2.8mm 4mm; border-top: .25mm solid #e2e8f0; vertical-align: top; color: #334155; } .rules td:first-child { font-weight: 700; color: #0c2e52; width: 36mm; background: #f8fafc; }

/* payroll */
.flow { display: flex; align-items: center; justify-content: space-between; background: #f0faf9; border-radius: 5mm; padding: 6mm 8mm; margin-bottom: 7mm; }
.flow div { text-align: center; flex: 1; } .flow b { display: block; font-size: 12pt; margin-top: 1mm; } .flow small { color: #64748b; font-size: 9.5pt; }
.split { display: flex; gap: 8mm; align-items: flex-start; }
.ticks { list-style: none; flex: 1; } .ticks li { display: flex; gap: 3mm; margin-bottom: 4mm; font-size: 11pt; color: #334155; } .ticks svg { margin-top: .8mm; } .ticks b { color: #0c2e52; }
.slip { width: 68mm; flex: none; border: .3mm solid #cbd5e1; border-radius: 4mm; overflow: hidden; box-shadow: 0 4mm 10mm rgba(12,46,82,.12); }
.slip-top { background: #0c2e52; color: #fff; padding: 3.5mm 4.5mm; font-size: 10pt; } .slip-top span { display: block; color: #9fd9d6; font-size: 9pt; }
.slip-rows { padding: 2mm 4.5mm; } .slip-rows p { display: flex; justify-content: space-between; font-size: 9.6pt; padding: 1.7mm 0; border-bottom: .25mm dashed #e2e8f0; } .slip-rows b { color: #0c2e52; }
.slip-net { display: flex; justify-content: space-between; align-items: center; background: #e8f6df; padding: 3mm 4.5mm; font-weight: 700; } .slip-net b { font-size: 14pt; color: #2a8204; }
.slip-note { font-size: 7.6pt; color: #94a3b8; text-align: center; padding: 1.6mm; }

/* why */
table.ba { width: 100%; border-collapse: separate; border-spacing: 0; border: .3mm solid #e2e8f0; border-radius: 4mm; overflow: hidden; margin-top: 4mm; }
.ba th { width: 50%; padding: 3mm 5mm; text-align: left; font-size: 11.5pt; } .ba th:first-child { background: #fff1f2; color: #be123c; } .ba th:last-child { background: #e8f6df; color: #2a8204; }
.ba td { padding: 3.2mm 5mm; border-top: .25mm solid #e2e8f0; font-size: 11pt; vertical-align: top; } .ba td svg { vertical-align: -0.6mm; margin-right: 2.5mm; } .ba td:first-child { color: #64748b; } .ba td:last-child { font-weight: 600; background: #fbfef9; }
.ba td { display: table-cell; } .ba td span { display: inline; }
.ba.compact { margin-top: 6mm; } .ba.compact td { padding: 2.4mm 5mm; font-size: 10.5pt; }
.who { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.5mm; } .who.four { grid-template-columns: repeat(4, 1fr); }
.who div { display: flex; align-items: center; gap: 3mm; border: .3mm solid #e2e8f0; border-radius: 3.5mm; padding: 3.5mm 4mm; font-weight: 600; font-size: 10.5pt; line-height: 1.25; }
.fact { background: #0c2e52; border-radius: 4mm; padding: 5mm; text-align: center; } .fact b { display: block; color: #7fe3df; font-size: 16pt; } .fact span { color: #dbe7f3; font-size: 9.8pt; }

/* plans */
.plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; align-items: stretch; margin-top: 2mm; }
.plan { border: .3mm solid #e2e8f0; border-radius: 5mm; padding: 6mm 5.5mm; position: relative; background: #fff; }
.plan.featured { border: .7mm solid #04837f; background: #f7fdfc; }
.pop { position: absolute; top: -3.2mm; left: 5.5mm; background: #04837f; color: #fff; font-size: 8pt; font-weight: 700; padding: .8mm 3mm; border-radius: 10mm; }
.price { font-size: 25pt; font-weight: 800; color: #0c2e52; line-height: 1.2; margin-top: 1mm; } .price small { font-size: 10pt; font-weight: 400; color: #64748b; }
.staff { font-size: 11pt; margin: 1mm 0 3.5mm; } .plan ul { list-style: none; font-size: 9.8pt; color: #334155; } .plan li { margin-bottom: 1.6mm; display: flex; gap: 2mm; align-items: center; }
.best { margin-top: 3.5mm; padding-top: 3mm; border-top: .25mm solid #e2e8f0; font-size: 9.8pt; color: #64748b; }
.trial { display: flex; align-items: center; gap: 3mm; justify-content: center; margin-top: 5mm; font-size: 11.5pt; } .trial b { color: #04837f; }
.start { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
.start div { background: #f8fafc; border-radius: 4mm; padding: 4mm; } .start span { display: grid; place-items: center; width: 8mm; height: 8mm; border-radius: 50%; background: #04837f; color: #fff; font-weight: 800; margin-bottom: 2mm; } .start p { font-size: 10.3pt; font-weight: 600; color: #0c2e52; line-height: 1.3; }
.cta { margin-top: 8mm; background: linear-gradient(100deg, #0c2e52, #04837f); border-radius: 5mm; padding: 8mm 9mm; display: flex; align-items: center; justify-content: space-between; gap: 6mm; }
.cta-small { color: #dbe7f3; font-size: 10.5pt; } .cta-big { color: #fff; font-size: 24pt; font-weight: 800; line-height: 1.3; }
.cta img { height: 15mm; background: #fff; border-radius: 3mm; padding: 2.5mm 4mm; }
@media screen { .page { margin: 6mm auto; box-shadow: 0 2mm 8mm rgba(0,0,0,.2); } }
`;

const doc = (title, pages) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${pages.join("")}<script>const p=new URLSearchParams(location.search).get("p");if(p){document.querySelectorAll(".page").forEach((e,i)=>{if(i+1!=p)e.remove()});document.body.style.background="#fff";document.querySelector(".page").style.margin="0";document.querySelector(".page").style.boxShadow="none"}</script></body></html>`;

writeFileSync(new URL("IWILL-Attend-Brochure.html", dir), doc("IWILL Attend brochure", [cover(), problems(2), how(3), attendance(4), rules(5), payroll(6), why(7), plans(8)]));
writeFileSync(new URL("IWILL-Attend-Brochure-Short.html", dir), doc("IWILL Attend brochure (short)", [cover(), shortHow(2), shortFeatures(3), plans(4)]));
console.log("Brochure HTML written.");
