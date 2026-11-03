// WebRTC mesh (one RTCPeerConnection per other person, up to 8 people in a room).
//
// - "Perfect negotiation": both sides may offer at any time; collisions are resolved
//   deterministically, so there is no glare deadlock.
// - Recovery: ICE restart first (3 times), then rebuild the connection (2 times), then report "failed".
// - The newcomer calls ensure() for everyone already in the room; existing members wait for the offer.

const MAX_RESTARTS = 3;
const MAX_REBUILDS = 2;

export function createMesh({ getIce, getLocalStream, getMyId, sendSignal, onTrack, onState, log = console }) {
  const peers = new Map();

  function setState(p, state) {
    if (p.state !== state) { p.state = state; onState(p.id, state); }
  }

  function dispose(p) {
    clearTimeout(p.timer);
    const pc = p.pc;
    pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null;
    try { pc.close(); } catch (e) { /* already closed */ }
    if (peers.get(p.id) === p) peers.delete(p.id);
  }

  function create(id, rebuilds = 0) {
    const pc = new RTCPeerConnection({ iceServers: getIce() });
    const p = {
      id, pc, polite: getMyId() < id, makingOffer: false, ignoreOffer: false, queue: [],
      stream: new MediaStream(), restarts: 0, rebuilds, timer: null, chain: Promise.resolve(), state: 'connecting',
    };
    peers.set(id, p);

    const local = getLocalStream();
    for (const kind of ['audio', 'video']) {
      const track = local?.getTracks().find((t) => t.kind === kind && t.readyState === 'live');
      if (track) pc.addTrack(track, local); else pc.addTransceiver(kind, { direction: 'recvonly' });
    }

    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      onTrack(id, p.stream);
    };
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal('ice-candidate', { to: id, candidate: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal('offer', { to: id, description: pc.localDescription.toJSON() });
      } catch (e) { log.warn('negotiation failed', e); } finally { p.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => onConnectionState(p);
    onState(id, 'connecting');
    return p;
  }

  function onConnectionState(p) {
    if (peers.get(p.id) !== p) return;
    const s = p.pc.connectionState;
    if (s === 'connected') {
      clearTimeout(p.timer); p.restarts = 0; p.rebuilds = 0; setState(p, 'connected');
    } else if (s === 'disconnected') {
      setState(p, 'reconnecting');
      clearTimeout(p.timer); p.timer = setTimeout(() => recover(p), 3000); // often heals by itself
    } else if (s === 'failed') {
      setState(p, 'reconnecting');
      clearTimeout(p.timer); recover(p);
    }
  }

  function recover(p) {
    if (peers.get(p.id) !== p || p.pc.connectionState === 'connected' || p.pc.connectionState === 'closed') return;
    if (p.restarts < MAX_RESTARTS && typeof p.pc.restartIce === 'function') {
      p.restarts++;
      p.pc.restartIce(); // fires negotiationneeded, which sends an offer with new ICE credentials
      clearTimeout(p.timer); p.timer = setTimeout(() => recover(p), 10000);
      return;
    }
    if (p.rebuilds >= MAX_REBUILDS) { setState(p, 'failed'); return; }
    rebuild(p.id, p.rebuilds + 1);
  }

  function rebuild(id, rebuilds) {
    const old = peers.get(id);
    if (old) dispose(old);
    const p = create(id, rebuilds);
    setState(p, 'reconnecting');
  }

  async function process(p, d) {
    const pc = p.pc;
    if (pc.signalingState === 'closed') return;
    const collision = d.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    await pc.setRemoteDescription(d); // the polite side rolls back its own offer implicitly
    for (const c of p.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    if (d.type === 'offer') {
      await pc.setLocalDescription();
      sendSignal('answer', { to: p.id, description: pc.localDescription.toJSON() });
    }
  }

  return {
    has: (id) => peers.has(id),
    ensure(id) { if (!peers.has(id)) create(id); },
    handleDescription(id, description) {
      let p = peers.get(id);
      if (description.type === 'offer' && p && ['failed', 'closed'].includes(p.pc.connectionState)) { dispose(p); p = null; } // the other side rebuilt
      if (!p) { if (description.type !== 'offer') return Promise.resolve(); p = create(id); }
      const peer = p;
      peer.chain = peer.chain.then(() => process(peer, description)).catch((e) => log.warn('description failed', e.message));
      return peer.chain;
    },
    handleCandidate(id, candidate) {
      const p = peers.get(id);
      if (!p) return;
      if (!p.pc.remoteDescription) p.queue.push(candidate);
      else p.pc.addIceCandidate(candidate).catch((e) => { if (!p.ignoreOffer) log.warn('candidate failed', e.message); });
    },
    // Swap the camera or microphone track without renegotiating (or add it if we had none).
    async replaceTrack(kind, track) {
      for (const p of peers.values()) {
        const t = p.pc.getTransceivers().find((x) => x.receiver.track?.kind === kind);
        if (!t) continue;
        await t.sender.replaceTrack(track).catch((e) => log.warn('replaceTrack', e.message));
        if (track && t.direction === 'recvonly') t.direction = 'sendrecv';
      }
    },
    retry(id) { rebuild(id, 0); },
    close(id) { const p = peers.get(id); if (p) dispose(p); },
    closeAll() { for (const p of [...peers.values()]) dispose(p); },
  };
}
