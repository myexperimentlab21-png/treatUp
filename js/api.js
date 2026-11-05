// ---------------------------------------------------------------
// api.js — the ONLY file that knows where the backend lives.
// Right now it talks to Google Apps Script.
// When you build the Node backend, rewrite just these functions
// (e.g. fetch('/api/events')) and the rest of the app stays the same.
// ---------------------------------------------------------------
import { API_URL } from './config.js';

async function readJson(res) {
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Something went wrong');
  return json.data;
}

async function get(action, params = {}) {
  const query = new URLSearchParams({ action, ...params, t: Date.now() });
  const res = await fetch(`${API_URL}?${query}`);
  return readJson(res);
}

// Apps Script tip: sending JSON as "text/plain" avoids a CORS preflight
// request, which Apps Script cannot answer.
async function post(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  return readJson(res);
}

export const api = {
  isConfigured: () => API_URL && !API_URL.startsWith('PASTE_'),

  // read
  getData: (pin) => get('data', pin ? { pin } : {}),
  checkPin: (pin) => get('checkPin', { pin }),

  // member
  respond: (eventId, personId, answers) => post('respond', { eventId, personId, ...answers }),

  // admin
  addPerson: (pin, name, phone) => post('addPerson', { pin, name, phone }),
  updatePerson: (pin, personId, fields) => post('updatePerson', { pin, personId, ...fields }),
  createEvent: (pin, event) => post('createEvent', { pin, ...event }),
  setWinner: (pin, eventId, winner, dishOptions) => post('setWinner', { pin, eventId, winner, dishOptions }),
  setStage: (pin, eventId, stage) => post('setStage', { pin, eventId, stage }),
  updateEventInfo: (pin, eventId, fields) => post('updateEventInfo', { pin, eventId, ...fields }),
  splitBill: (pin, eventId, total, extra = {}) => post('splitBill', { pin, eventId, total, ...extra }),
  finishEvent: (pin, eventId, extra = {}) => post('finishEvent', { pin, eventId, ...extra }),
  addImage: (pin, eventId, file) => post('addImage', { pin, eventId, ...file }),
  recordPayment: (pin, personId, amount, note) => post('recordPayment', { pin, personId, amount, note }),
  addCharge: (pin, personId, amount, note) => post('addCharge', { pin, personId, amount, note }),
};
