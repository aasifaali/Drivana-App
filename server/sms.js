// SMS delivery for OTPs. "console" prints the message to the server log, which
// is enough for local testing and a closed pilot. To go live, add a provider
// here (MSG91, 2Factor, Twilio…) and set SMS_PROVIDER in .env.
export async function sendSms(config, phone, message, log) {
  switch (config.smsProvider) {
    case 'console':
      log.info({ phone }, `[SMS] ${message}`);
      return;
    default:
      throw new Error(`SMS provider "${config.smsProvider}" is not implemented in server/sms.js`);
  }
}
