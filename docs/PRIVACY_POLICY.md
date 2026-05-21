# Privacy Policy — Justice Gavel
*Last updated: May 2025*

## Overview
Justice Gavel ("we," "us," "our") provides a mobile application and web platform that helps individuals navigate the U.S. criminal justice system. We take the privacy of your legal information seriously.

## Information We Collect

### Information you provide
- **Account information**: email address, password (hashed with bcrypt, never stored in plaintext)
- **Case notes**: information you enter about your legal situation
- **Voice recordings**: audio recorded via the Interrogation Recorder feature, processed locally and optionally stored encrypted on our servers
- **Messages**: communications with attorneys through our platform
- **Payment information**: handled entirely by Stripe — we never see or store your card number

### Information collected automatically
- **Device type and operating system** (for bug diagnosis)
- **App usage events** (which features you use, for product improvement)
- **Error reports** (via Sentry, anonymized — no personal legal content included)
- **IP address** (for rate limiting and fraud prevention, not stored long-term)

### Information we do not collect
- We do not sell your data to advertisers
- We do not share your case notes or legal information with third parties except attorneys you explicitly connect with through the platform
- We do not use your data to train AI models

## How We Use Your Information

- **Providing the service**: connecting you with attorneys, generating legal documents, providing AI legal guidance
- **AI features**: your messages are sent to Anthropic's Claude API to generate responses. Anthropic's [usage policies](https://www.anthropic.com/legal/usage-policy) apply
- **Communications**: appointment reminders, case deadline alerts (only what you opt into)
- **Safety**: emergency SOS alerts are sent to contacts you explicitly configure

## Data Retention
- Account data: retained until you delete your account
- Case notes: deleted within 30 days of account deletion
- Voice recordings: stored only with your explicit consent; deleted on your request
- Payment records: retained for 7 years per financial regulations (Stripe holds the sensitive data)

## Your Rights
Depending on your location, you may have the right to:
- Access the personal data we hold about you
- Correct inaccurate data
- Delete your account and associated data
- Export your data in machine-readable format

To exercise these rights, email: **privacy@justicegavel.app**

## Security
- All data transmitted using TLS 1.3
- Case notes and voice recordings encrypted at rest using AES-256
- Authentication tokens expire after 24 hours
- Two-factor authentication available for attorney accounts

## Children's Privacy
Justice Gavel is not directed at children under 13. We do not knowingly collect data from children under 13.

## AI-Generated Content Disclaimer
The AI legal guidance provided by Justice Gavel is for informational purposes only. It is not legal advice and does not create an attorney-client relationship. Laws vary by jurisdiction and change frequently. Always consult a licensed attorney for advice specific to your situation.

## Changes to This Policy
We will notify you of material changes via the app or email. Continued use of the service after notice constitutes acceptance.

## Contact
Justice Gavel
privacy@justicegavel.app
support@justicegavel.app


## Health-Related Information in Case Notes

Justice Gavel is **not** a HIPAA-covered entity and does not provide healthcare services. However, case notes you create may reference health-related information such as mental health history, substance abuse treatment, or disability status when those matters are relevant to your legal case.

We treat any health-related information in your case notes with the same strict protections as all other legal content:
- Encrypted at rest with AES-256
- Never shared with third parties without your explicit consent
- Deleted within 30 days of account deletion

If your legal matter involves health-related information that is protected under HIPAA or other health privacy laws, we recommend consulting with your attorney about the appropriate way to document it.
