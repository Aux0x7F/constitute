// FILE: identity/sw/swarm/resolve.js
import { getIdentityRecord, getDeviceRecord, validateRecord } from './discovery.js';

export async function resolveIdentityById(identityId) {
  const ev = await getIdentityRecord(identityId);
  if (!ev) return null;
  const ok = await validateRecord(ev, 'identity');
  if (!ok) return null;
  return JSON.parse(ev.content || '{}');
}

export async function resolveDeviceByPk(devicePk) {
  const ev = await getDeviceRecord(devicePk);
  if (!ev) return null;
  const ok = await validateRecord(ev, 'device');
  if (!ok) return null;
  return JSON.parse(ev.content || '{}');
}

export async function resolveIdentityForDevice(devicePk) {
  const dev = await resolveDeviceByPk(devicePk);
  if (!dev?.identityId) return null;
  const ident = await resolveIdentityById(dev.identityId);
  return ident || null;
}
