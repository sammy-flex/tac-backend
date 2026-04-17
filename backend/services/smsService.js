// services/smsService.js
// SMS Providers: bulkSMS Ghana (primary), Arkesel, Hubtel
// TEST MODE: logs to console — no real SMS sent when SMS_TEST_MODE=true
const axios = require('axios');

const SMS_MESSAGE = `You have successfully been registered for TAC National Youth Camp. Please kindly adhere to all rules and regulations governing this camp meeting. TAC NGYN! God first. Prophetic. Transformational. Tututututu Vuuuuum—Lyrical Technologies.`;

const OTP_TEMPLATE = (otp, minutes) =>
  `Your TAC National Youth Camp verification code is: ${otp}. Valid for ${minutes} minutes. Do not share this code. —Lyrical Technologies.`;

// ==================== TEST MODE ====================
function sendTestSMS(phone, message) {
  const clean = normalizePhone(phone);
  console.log('\n' + '='.repeat(65));
  console.log('📲  [SMS TEST MODE — NOT ACTUALLY SENT]');
  console.log('='.repeat(65));
  console.log(`TO:       ${clean}`);
  console.log(`MESSAGE:  ${message}`);
  console.log('='.repeat(65) + '\n');
  return { provider: 'test_mode', phone: clean, simulated: true };
}

// ==================== BULKSMS GHANA (FIXED) ====================
async function sendViaBulkSMSGhana(phone, message) {
  const cleanPhone = normalizePhone(phone);
  // CORRECT URL for BulkSMS Ghana
  const apiUrl = process.env.BULKSMS_GHANA_URL || 'https://clientlogin.bulksmsgh.com/smsapi';
  const apiKey = process.env.BULKSMS_GHANA_API_KEY;
  const senderId = process.env.BULKSMS_GHANA_SENDER_ID || 'TACCamp';

  console.log(`[bulkSMS Ghana] Sending to ${cleanPhone} using URL: ${apiUrl}`);

  try {
    // GET request with query parameters (BulkSMS Ghana format)
    const response = await axios.get(apiUrl, {
      params: {
        key: apiKey,
        to: cleanPhone,
        msg: message,
        sender_id: senderId,
      },
      timeout: 15000,
    });

    console.log('[bulkSMS Ghana] Response:', JSON.stringify(response.data));

    const d = response.data;
    // Check for success response
    if (d?.success === true || d?.code === 1000 || d?.status === 'success') {
      return { provider: 'bulksms_ghana', response: d, phone: cleanPhone };
    }
    
    throw new Error(`bulkSMS Ghana error: ${JSON.stringify(d)}`);

  } catch (err) {
    console.error('[bulkSMS Ghana] Error:', err.message);
    if (err.response) {
      console.error('[bulkSMS Ghana] Response data:', JSON.stringify(err.response.data));
    }
    throw err;
  }
}

// ==================== ARKESEL ====================
async function sendViaArkesel(phone, message) {
  const cleanPhone = normalizePhone(phone);
  const response = await axios.get('https://sms.arkesel.com/sms/api', {
    params: {
      action:  'send-sms',
      api_key: process.env.ARKESEL_API_KEY,
      to:      cleanPhone,
      from:    process.env.ARKESEL_SENDER_ID || 'TACCamp',
      sms:     message,
    },
    timeout: 12000,
  });
  if (response.data?.code !== 'ok') {
    throw new Error(`Arkesel error: ${JSON.stringify(response.data)}`);
  }
  return { provider: 'arkesel', response: response.data };
}

// ==================== HUBTEL ====================
async function sendViaHubtel(phone, message) {
  const cleanPhone = normalizePhone(phone);
  const credentials = Buffer.from(
    `${process.env.HUBTEL_CLIENT_ID}:${process.env.HUBTEL_CLIENT_SECRET}`
  ).toString('base64');
  const response = await axios.post(
    'https://devapi.hubtel.com/sms/messages',
    {
      From:    process.env.HUBTEL_SENDER_ID || 'TACCamp',
      To:      cleanPhone,
      Content: message,
    },
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      timeout: 12000,
    }
  );
  if (response.data?.Status !== 0) {
    throw new Error(`Hubtel error: ${JSON.stringify(response.data)}`);
  }
  return { provider: 'hubtel', response: response.data };
}

// ==================== OTP SENDER ====================
async function sendOTP(phone, otp) {
  const minutes = parseInt(process.env.OTP_EXPIRES_MINUTES) || 10;
  const message = OTP_TEMPLATE(otp, minutes);
  return await sendSMS(phone, message);
}

// ==================== REGISTRATION SMS ====================
async function sendRegistrationSMS(phone, participantName) {
  if (!phone || phone.trim() === '') {
    console.log('[SMS] Skipped — no phone number provided');
    return { skipped: true, reason: 'No phone number provided' };
  }
  return await sendSMS(phone, SMS_MESSAGE);
}

// ==================== MAIN DISPATCHER ====================
async function sendSMS(phone, message) {
  // TEST MODE — logs to console only, no real API call
  if (process.env.SMS_TEST_MODE === 'true') {
    return sendTestSMS(phone, message);
  }

  const provider = (process.env.SMS_PROVIDER || 'bulksms_ghana').toLowerCase();

  console.log(`[SMS] Sending via ${provider} to ${phone}`);

  try {
    switch (provider) {
      case 'bulksms_ghana':
      case 'bulksms':
        return await sendViaBulkSMSGhana(phone, message);
      case 'arkesel':
        return await sendViaArkesel(phone, message);
      case 'hubtel':
        return await sendViaHubtel(phone, message);
      default:
        console.warn(`[SMS] Unknown provider "${provider}" — defaulting to bulkSMS Ghana`);
        return await sendViaBulkSMSGhana(phone, message);
    }
  } catch (error) {
    console.error(`[SMS] Failed to send to ${phone} via ${provider}:`, error.message);
    if (error.response) {
      console.error('[SMS] Response status:', error.response.status);
      console.error('[SMS] Response data:', JSON.stringify(error.response.data));
    }
    throw error;
  }
}

// ==================== PHONE NORMALISER ====================
function normalizePhone(phone) {
  if (!phone) return '';
  let p = phone.replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
  if (p.startsWith('0') && p.length === 10) {
    p = '+233' + p.slice(1);
  }
  else if (p.startsWith('233') && !p.startsWith('+')) {
    p = '+' + p;
  }
  return p;
}

module.exports = {
  sendRegistrationSMS,
  sendOTP,
  sendSMS,
  normalizePhone,
};