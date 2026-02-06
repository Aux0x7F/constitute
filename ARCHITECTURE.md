# Constitute – Architecture Overview

Constitute is a browser-native, decentralized identity and device association system built around cryptographic device identity, relay-based signaling, and progressive movement toward peer-to-peer swarm synchronization. The project is intentionally modular and transport-agnostic, with security and identity primitives implemented first, and higher-level collaboration features layered on top.

This document orients contributors to the current structure, module responsibilities, and roadmap direction.

## Core Concepts

### Identity
An Identity is a logical grouping of devices.
It is not a username or profile — it is a cryptographic association set.

- Stored as shared state across associated devices
- Contains:
  - Identity label (human-readable)
  - Identity ID (stable unique identifier)
  - Device list
  - Room/shared keys (for encrypted state)
- Exists as a “room” concept over relay transport today, swarm later

### Device
A Device is a cryptographic endpoint.

- Has a DID-like identifier
- May be:
  - Software-backed (soft key)
  - Platform-backed (WebAuthn / TPM)
- Has a required human label
- Devices can be approved or rejected by existing devices in the identity

### Pairing
Pairing is the process of associating a new device to an identity.

- Device requests pairing
- Existing device approves or rejects
- Approval results in:
  - Device added to identity
  - Shared keys exchanged
  - Request resolved at source
- Pending requests must never persist after resolution

### Notifications
Notifications are identity-scoped state.

- Represent events such as pairing requests or approvals
- Stored as structured data, not UI artifacts
- Support:
  - Clear
  - Remove
  - Sync across devices (configurable per-device vs global)

## High-Level Architecture

Browser UI
- app.js
  - Activity routing (Home / Settings / Onboarding)
  - Navigation drawer + notification bell
  - SharedWorker relay bridge
- identity/client.js
  - RPC bridge to Service Worker daemon
- relay.worker.js (SharedWorker)
  - Persistent WebSocket transport

Service Worker (Identity Daemon)
- identity/sw/daemon.js
  - Device state
  - Identity state
  - Pairing lifecycle
  - Notifications state
  - Relay frame handling
- identity/sw/idb.js
  - IndexedDB abstraction
- identity/sw/crypto.js
  - Signing / encryption helpers
- identity/sw/nostr.js
  - Relay event formatting / signing
- identity/sw/zone.js
  - Zone key derivation + presence
- identity/sw/directory.js
  - Device directory store

## Transport Layers

### Current
- WebSocket Relay (Nostr-style)
- SharedWorker owns persistent connection
- Service Worker owns signing, parsing, and state updates
- Window only transports frames, never secrets

### Planned
- Swarm / Peer-to-Peer Transport
  - WebRTC mesh or DHT
  - Relay becomes optional bootstrap
  - Encrypted room state synchronization
  - Device discovery via distributed lookup

## Discovery + Directory

Zones are the discovery scope. Devices join zones via a sharable link (zone key).

- Zone keys are generated at creation time (randomized, human label stored locally)
- Zone presence + member lists are published over relay
- Directory is a local store of discovered devices
- Directory powers Peers (discovery) and future apps


## State Storage

### IndexedDB
Authoritative local state store.

Stores:
- Device metadata
- Identity metadata
- Pairing requests
- Notifications
- Blocked devices
- Directory entries
- Zone list

### Relay / Room State
Ephemeral + syncable channel.

Used for:
- Pairing request broadcast
- Pair approval events
- Notifications clear sync (optional)
- Device/identity label updates
- Zone presence

## Security Model

- Device-level signing mandatory
- WebAuthn / TPM encouraged during onboarding
- Software fallback supported
- Room keys symmetric, distributed via trusted device approval
- UI never holds secret keys
- Service Worker is cryptographic authority

## Pairing Lifecycle Rules

1. Request created -> status = pending
2. Approval or rejection:
   - Status updated immediately
   - Identity device list updated
   - Notification emitted
3. Pending lists only show pending
4. Requests referencing known devices are auto-filtered
5. Requester device auto-advances to Home when approved

## Notifications Rules

- Stored as structured objects
- Clearing updates data store, not just UI
- May propagate as room state
- Never persist “phantom” items after resolution

## Roadmap

### Near Term
- Stabilize zone list propagation + naming
- Clean up Peers UX

### Mid Term
- Swarm/DHT bootstrap integration (primary transport)
- Peer-to-peer synchronization
- Replace relay dependency for most state
- Shared encrypted data layers
- Messaging maturation + double-ratchet encryption

### Long Term
- Full decentralized app substrate
- Identity-scoped application namespaces
- Cross-app identity federation
- Plugin / module system

## Design Principles

- Transport agnostic
- Security first
- State authoritative in daemon
- UI is observer, not source of truth
- Progressive decentralization
- Minimal implicit trust
- Deterministic lifecycle resolution
