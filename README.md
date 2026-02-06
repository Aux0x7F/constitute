# Constitute

Browser-native, decentralized identity and device association system with relay-based signaling and a path to peer-to-peer swarm sync.

## Status
- Prototype: active development
- Discovery bootstrap achieved (zones + directory)
- Next focus: swarm transport (DHT / P2P)

## Key Concepts
- Identity: cryptographic grouping of devices
- Device: cryptographic endpoint, optionally WebAuthn-backed
- Pairing: device association via approval flow
- Zone: discovery scope joined by a shareable key
- Directory: local store of discovered devices

## Features
- Device identity (software + WebAuthn option)
- Identity create/join with pairing approval flow
- Notifications + pending request management
- Relay transport via SharedWorker
- Directory of discovered devices (from zone presence)

## Project Layout
- app.js: UI + activity routing + SW RPC client
- identity/client.js: SW RPC client
- relay.worker.js: WebSocket relay transport (SharedWorker)
- identity/sw/*: Service Worker identity daemon
- ARCHITECTURE.md: system architecture and roadmap

## Architecture
See `ARCHITECTURE.md` for the full system overview and roadmap.

## Running Locally
1. Serve the repo at http://localhost:8000 (any static server)
2. Open in a modern browser with Service Worker support
3. Ensure HTTPS or localhost for WebAuthn

## Usage
- Create an identity or join an existing one
- Pair additional devices using the pairing flow
- Settings > Peers manages zones and discovery devices
- If no identity is linked, the UI redirects to onboarding

## Zones
- Zones are discovery scopes with a human label
- Keys are generated at creation and shared via link
- Zone presence + member lists update the Directory

## Roadmap Snapshot
- Stabilize zone list propagation + naming
- Add Kademlia-style DHT (primary transport)
- Swarm transport and discovery
- Shared encrypted data layers
- Messaging maturation + double-ratchet encryption

## TODO
- Improve Peers UX clarity
- Swarm transport and discovery
- Shared encrypted data layers
- Messaging maturation + double-ratchet encryption

## Security Notes
- UI never handles secret keys
- Service Worker is the cryptographic authority
- Relay is transport only (no trust assumed)

## License
TBD
