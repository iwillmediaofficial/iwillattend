// Details printed on the Privacy Policy and Terms pages.
// A value still in [square brackets] is shown highlighted on the page as "to be filled in".
export const LEGAL = {
  /** The legal name of the business that runs IWILL Attend, e.g. "IWILL Media Private Limited". */
  company: "Yuiee Marketing Solutions",
  /** Registered or business address. */
  address: "2nd Floor, Paradise Holidays East, Kadungalloor, Aluva, Keralam 683102",
  /** Public contact email for privacy and support questions. */
  email: "iwillattend11@gmail.com",
  /** Named Grievance Officer. Leave empty to direct complaints to the support email instead. */
  grievanceName: "",
  grievanceEmail: "",
  /** City whose courts handle disputes. */
  courtsCity: "Ernakulam",
  /** Date these documents take effect. */
  effective: "18 November 2026",
};

export const isPlaceholder = (v: string) => v.startsWith("[");
