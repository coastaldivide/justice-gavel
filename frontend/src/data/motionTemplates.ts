/**
 * motionTemplates.ts — Offline motion templates
 *
 * 7 common motion types with skeleton structure.
 * Available without network — user fills in case-specific details.
 * AI generation enhances these when online.
 */

export interface MotionTemplate {
  key: string;
  label: string;
  description: string;
  template: string;
}

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    key: 'continue',
    label: 'Motion for Continuance',
    description: 'Request more time to prepare your defense.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION FOR CONTINUANCE

Comes now Defendant, [DEFENDANT FULL NAME], and respectfully moves this Court to
continue the [HEARING TYPE] currently scheduled for [CURRENT DATE], and states:

1. Defendant's counsel [requires additional time / Defendant is obtaining counsel]
   because [REASON].

2. A continuance is necessary to ensure Defendant receives effective assistance
   of counsel and a fair opportunity to prepare an adequate defense.

3. The State [will / will not] be prejudiced by a continuance.

WHEREFORE, Defendant respectfully requests that this Court grant a continuance
of [NUMBER] days to allow adequate preparation.

Respectfully submitted,

_______________________________
[DEFENDANT NAME or ATTORNEY NAME]
[ADDRESS]
[PHONE]
[DATE]

CERTIFICATE OF SERVICE
I hereby certify that a copy of the foregoing has been served upon the
[State's Attorney / District Attorney] on [DATE].`,
  },
  {
    key: 'suppress',
    label: 'Motion to Suppress',
    description: 'Challenge unlawfully obtained evidence.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION TO SUPPRESS EVIDENCE

Defendant, [DEFENDANT FULL NAME], moves this Court to suppress all evidence
obtained as a result of the unlawful [SEARCH / SEIZURE / STOP], and states:

STATEMENT OF FACTS
On [DATE], at approximately [TIME], at [LOCATION], law enforcement officers
[DESCRIBE WHAT HAPPENED — e.g., "stopped Defendant's vehicle without reasonable
suspicion and conducted a warrantless search"].

ARGUMENT
I. THE [SEARCH / SEIZURE / STOP] VIOLATED THE FOURTH AMENDMENT.

[State the specific constitutional violation. Example: Officers lacked reasonable
suspicion to stop the vehicle. There was no warrant, no consent, and no exception
to the warrant requirement applied.]

II. THE EXCLUSIONARY RULE REQUIRES SUPPRESSION.

Under the exclusionary rule established in Mapp v. Ohio, 367 U.S. 643 (1961),
evidence obtained in violation of the Fourth Amendment must be suppressed.
All evidence discovered as a result of the unlawful [SEARCH/STOP] is "fruit of
the poisonous tree" and must likewise be suppressed. Wong Sun v. United States,
371 U.S. 471 (1963).

CONCLUSION
For the foregoing reasons, Defendant respectfully requests that this Court
suppress all evidence obtained as a result of the unlawful [SEARCH / SEIZURE].

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
  {
    key: 'dismiss',
    label: 'Motion to Dismiss',
    description: 'Ask the court to dismiss charges.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION TO DISMISS

Defendant, [DEFENDANT FULL NAME], moves this Court to dismiss the charges
against Defendant with prejudice, and states:

GROUNDS FOR DISMISSAL
[Select applicable ground(s):]

[ ] 1. INSUFFICIENT EVIDENCE
    The charging document fails to allege facts constituting a criminal offense.
    The State cannot establish [ELEMENT] beyond a reasonable doubt.

[ ] 2. SPEEDY TRIAL VIOLATION
    Defendant has been denied the right to a speedy trial under [State Statute /
    the Sixth Amendment]. The case has been pending for [NUMBER] days without
    trial, causing [DESCRIBE PREJUDICE].

[ ] 3. STATUTE OF LIMITATIONS
    The charged offense occurred on [DATE], and the applicable statute of
    limitations of [NUMBER] years has expired.

[ ] 4. DOUBLE JEOPARDY
    Defendant was previously tried for this same offense in [COURT] on [DATE].

CONCLUSION
For the foregoing reasons, Defendant respectfully requests that this Court
dismiss all charges with prejudice.

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
  {
    key: 'bail_reduction',
    label: 'Motion for Bail Reduction',
    description: 'Request the court to lower your bail amount.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION FOR BAIL REDUCTION

Defendant, [DEFENDANT FULL NAME], respectfully moves this Court to reduce the
bail currently set at $[CURRENT BAIL AMOUNT], and states:

1. TIES TO THE COMMUNITY
   Defendant has lived in [CITY], [STATE] for [NUMBER] years.
   Defendant is employed by [EMPLOYER / SELF-EMPLOYED] and supports
   [FAMILY MEMBERS].

2. INABILITY TO PAY
   Defendant's total monthly income is approximately $[INCOME].
   The current bail of $[AMOUNT] constitutes [NUMBER]% of annual income
   and is effectively a pre-trial detention order.

3. LOW FLIGHT RISK
   Defendant has [no / limited] prior criminal history.
   Defendant has [always / consistently] appeared for prior court dates.
   Defendant has no history of failing to appear.

4. LOW DANGER TO COMMUNITY
   The charged offense is [DESCRIBE]. Defendant poses no danger to
   the community if released.

PROPOSED CONDITIONS OF RELEASE
Defendant proposes the following release conditions:
   [ ] Electronic monitoring / GPS ankle monitor
   [ ] Regular check-ins with pretrial services
   [ ] Reduced bail of $[PROPOSED AMOUNT]
   [ ] Surrender of passport
   [ ] Other: [CONDITION]

CONCLUSION
Defendant respectfully requests that this Court reduce bail to $[AMOUNT]
or impose non-monetary conditions of release.

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
  {
    key: 'discovery',
    label: 'Motion for Discovery',
    description: 'Request the prosecution share its evidence.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION FOR DISCOVERY

Defendant, [DEFENDANT FULL NAME], pursuant to [State Rules of Criminal
Procedure, Rule __], requests that the State provide the following:

1. POLICE REPORTS
   All police reports, incident reports, and supplemental reports relating
   to the investigation of the above-captioned case.

2. WITNESS INFORMATION
   The names, addresses, and statements of all witnesses the State intends
   to call at trial, including law enforcement officers.

3. PHYSICAL EVIDENCE
   An inventory of all physical evidence the State intends to introduce
   at trial, and an opportunity to inspect and copy such evidence.

4. EXCULPATORY EVIDENCE (Brady Material)
   All evidence favorable to Defendant, including any evidence that may
   impeach State witnesses or negate guilt. Brady v. Maryland, 373 U.S. 83.

5. EXPERT WITNESSES
   The names and qualifications of all expert witnesses and copies of
   any reports prepared by such experts.

6. PRIOR CRIMINAL RECORDS
   Any prior criminal records or prior bad act evidence the State intends
   to introduce under applicable evidence rules.

7. RECORDINGS
   Any audio or video recordings, including body camera footage,
   dashcam footage, 911 calls, or surveillance footage.

CONCLUSION
Defendant requests that the above discovery be provided within [14/30] days.

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
  {
    key: 'limine',
    label: 'Motion in Limine',
    description: 'Ask the court to exclude specific evidence at trial.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION IN LIMINE TO EXCLUDE [DESCRIBE EVIDENCE]

Defendant respectfully moves this Court to enter an order excluding
[DESCRIBE THE EVIDENCE TO EXCLUDE] at trial, and states:

BACKGROUND
[Describe what the evidence is and how the State intends to use it.]

ARGUMENT
The challenged evidence should be excluded because:

1. [BASIS FOR EXCLUSION — e.g., "The evidence is irrelevant under [State]
   Rule of Evidence 401 because it does not tend to make any fact of
   consequence more or less probable."]

2. [ADDITIONAL BASIS — e.g., "Even if relevant, the evidence's probative
   value is substantially outweighed by the danger of unfair prejudice
   under Rule 403."]

3. [IF APPLICABLE — "The evidence constitutes improper character evidence
   under Rule 404(b)."]

CONCLUSION
For the foregoing reasons, Defendant respectfully requests that this Court
exclude [DESCRIBE EVIDENCE] from trial.

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
  {
    key: 'diversion',
    label: 'Motion for Diversion / Deferred Prosecution',
    description: 'Request an alternative to prosecution.',
    template: `IN THE [COURT NAME]
[COUNTY] COUNTY, [STATE]

STATE OF [STATE],
    Plaintiff,

v.                                    Case No. [CASE NUMBER]

[DEFENDANT FULL NAME],
    Defendant.

MOTION FOR DIVERSION / DEFERRED PROSECUTION

Defendant, [DEFENDANT FULL NAME], respectfully requests that this Court
grant Defendant entry into a diversion or deferred prosecution program,
and states:

1. ELIGIBILITY
   Defendant is charged with [CHARGE], a [CLASS] [misdemeanor/felony].
   Defendant [has no prior criminal history / has limited prior history].
   Defendant meets the eligibility criteria under [State Statute].

2. BACKGROUND AND CHARACTER
   Defendant is [AGE] years old and has lived in [CITY] for [NUMBER] years.
   Defendant is [employed / a student / primary caregiver] for [DESCRIBE].
   This incident was an aberration from Defendant's otherwise law-abiding life.

3. PROPOSED TERMS
   Defendant agrees to comply with the following conditions:
   [ ] Community service: [NUMBER] hours
   [ ] Substance abuse treatment / counseling
   [ ] Regular reporting to pretrial services
   [ ] No new criminal charges
   [ ] Restitution of $[AMOUNT] to [VICTIM]
   [ ] Other: [CONDITION]

4. PUBLIC INTEREST
   Diversion serves the public interest because it allows Defendant to
   address the underlying issues, make restitution, and become a
   productive member of the community without the collateral consequences
   of a criminal conviction.

CONCLUSION
Defendant respectfully requests that this Court grant this motion and
admit Defendant to a diversion program.

Respectfully submitted,
_______________________________
[NAME]
[DATE]`,
  },
];
