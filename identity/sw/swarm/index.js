// FILE: identity/sw/swarm/index.js
export {
  makeIdentityRecord,
  makeDeviceRecord,
  putIdentityRecord,
  putDeviceRecord,
  getIdentityRecord,
  getDeviceRecord,
  listIdentityRecords,
  listDeviceRecords,
  validateRecord,
} from './discovery.js';

export {
  resolveIdentityById,
  resolveDeviceByPk,
  resolveIdentityForDevice,
} from './resolve.js';
