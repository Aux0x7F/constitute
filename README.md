# Constitute

Browser-native, decentralized identity and device association system with relay-based signaling and a path to peer-to-peer swarm sync.

## Status
- Prototype: active development
- Current focus: discovery (neighborhoods), directory, and basic messaging

## Key Concepts
- Identity: cryptographic grouping of devices
- Device: cryptographic endpoint, optionally WebAuthn-backed
- Pairing: device association via approval flow
- Neighborhood: discovery scope derived from identityId + roomKey
- Directory: local store of discovered identities

## Features
- Device identity (software + WebAuthn option)
- Identity create/join with pairing approval flow
- Notifications + pending request management
- Relay transport via SharedWorker
- Directory of discovered identities (from neighborhood presence)
- Messages app with basic chat queues

## Project Layout
- app.js: UI + activity routing + SW RPC client
- identity/client.js: SW RPC client
- relay.worker.js: WebSocket relay transport (SharedWorker)
- identity/sw/*: Service Worker identity daemon
- ARCHITECTURE.md: system architecture and roadmap

## Running Locally
1. Serve the repo at http://localhost:8000 (any static server)
2. Open in a modern browser with Service Worker support
3. Ensure HTTPS or localhost for WebAuthn

## Usage
- Create an identity or join an existing one
- Pair additional devices using the pairing flow
- Messages app uses the Directory to start chats
- Directory app manages neighborhoods and membership

## Neighborhoods
- Default neighborhood key is derived from identityId + roomKey
- Additional neighborhoods can be created and shared via link
- Neighborhood presence updates the Directory

## Roadmap Snapshot
- Fix propagation of messages + neighborhood members
- Clean up Messages/Directory UX and flows
- Add double-ratchet encryption
- Add Kademlia-style DHT with relay fallback

## TODO
- Resolve message propagation (receiver updates)
- Resolve neighborhood member propagation timing
- Improve UI clarity (messages vs directory)
- Add end-to-end encryption (double ratchet)

## Security Notes
- UI never handles secret keys
- Service Worker is the cryptographic authority
- Relay is transport only (no trust assumed)

## License
TBD
