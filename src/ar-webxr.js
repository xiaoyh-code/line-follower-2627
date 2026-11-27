import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';

export async function startCourseXR({
  mode = 'immersive-ar', renderer, scene, camera, assembly, overlayRoot, courseControls,
  onStatus, onPlaced, onEnd,
}) {
  const xr = navigator.xr;
  if (!xr) throw new Error('WebXR is unavailable.');
  if (mode !== 'immersive-ar' && mode !== 'immersive-vr') throw new Error('Unsupported WebXR mode.');

  const isAR = mode === 'immersive-ar';
  const options = isAR
    ? { requiredFeatures: ['hit-test'], optionalFeatures: overlayRoot ? ['dom-overlay'] : [] }
    : {};
  if (isAR && overlayRoot) options.domOverlay = { root: overlayRoot };
  const session = await xr.requestSession(mode, options);

  const originalParent = assembly.parent;
  const originalVisibility = assembly.visible;
  const originalBackground = scene.background;
  const originalClearAlpha = renderer.getClearAlpha();
  const originalCamera = camera?.clone(false);
  const originalXREnabled = renderer.xr.enabled;
  const anchor = new Group();
  const marker = isAR ? createSurfaceMarker() : null;
  let reference;
  let hitTest;
  let placed = false;
  let ended = false;
  let restored = false;
  let mounted = false;
  let ready = false;
  let status;
  let endRequest;
  let resolveEnded;
  const sessionEnded = new Promise(resolve => { resolveEnded = resolve; });

  function report(next) {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  function place() {
    placed = true;
    anchor.visible = true;
    if (marker) marker.visible = false;
    report(isAR ? 'placed' : 'viewing');
    onPlaced?.();
  }

  function reset() {
    if (ended) return;
    placed = false;
    anchor.visible = false;
    if (marker) {
      marker.visible = false;
      report('scanning');
    }
  }

  function select(event) {
    if (ended) return;
    if (placed) {
      if (courseControls) courseControls.select(event, reference);
      else onPlaced?.();
    } else if (marker?.visible) {
      anchor.position.copy(marker.position);
      anchor.quaternion.copy(marker.quaternion);
      place();
    }
  }

  function update(frame) {
    if (!frame || !reference || ended) return;
    if (placed) {
      courseControls?.update(frame, reference, session.inputSources);
      return;
    }
    if (!isAR) {
      const viewer = frame.getViewerPose(reference)?.transform;
      if (!viewer) return;
      const direction = new Vector3(0, 0, -1).applyQuaternion(viewer.orientation);
      direction.y = 0;
      if (direction.lengthSq() < 0.01) direction.set(0, 0, -1);
      direction.normalize();
      anchor.position.set(viewer.position.x, viewer.position.y - 0.65, viewer.position.z);
      anchor.position.addScaledVector(direction, 1.25);
      anchor.rotation.y = Math.atan2(-direction.x, -direction.z);
      place();
      return;
    }

    let surface;
    for (const result of frame.getHitTestResults(hitTest)) {
      const transform = result.getPose(reference)?.transform;
      if (transform?.matrix[5] > 0.8) {
        surface = transform;
        break;
      }
    }
    marker.visible = Boolean(surface);
    if (surface) {
      marker.position.copy(surface.position);
      marker.quaternion.copy(surface.orientation);
    }
    report(surface ? 'surface' : 'scanning');
  }

  function preventOverlayPlacement(event) {
    if (event.target.closest?.('button, a, input, select, textarea, [role="button"]')) event.preventDefault();
  }

  function restore() {
    if (restored) return;
    restored = true;
    try { hitTest?.cancel(); } catch { /* The session may already have invalidated the source. */ }
    session.removeEventListener('select', select);
    session.removeEventListener('end', onSessionEnd);
    reference?.removeEventListener('reset', reset);
    overlayRoot?.removeEventListener('beforexrselect', preventOverlayPlacement);
    if (marker) {
      marker.removeFromParent();
      marker.geometry.dispose();
      marker.material.dispose();
    }
    if (mounted) {
      assembly.removeFromParent();
      originalParent?.add(assembly);
      assembly.visible = originalVisibility;
      courseControls?.group.removeFromParent();
      anchor.removeFromParent();
      scene.background = originalBackground;
      renderer.setClearAlpha(originalClearAlpha);
      renderer.xr.enabled = originalXREnabled;
      if (camera && originalCamera) camera.copy(originalCamera, false);
    }
    if (ready) {
      report('ended');
      onEnd?.();
    }
  }

  function onSessionEnd() {
    ended = true;
    queueMicrotask(() => {
      try { restore(); } finally { resolveEnded(); }
    });
  }

  async function end() {
    if (!ended) {
      endRequest ??= session.end().catch(error => {
        endRequest = null;
        if (error.name !== 'InvalidStateError') throw error;
      });
      await endRequest;
    }
    await sessionEnded;
  }

  session.addEventListener('end', onSessionEnd, { once: true });
  try {
    if (isAR) {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      hitTest = await session.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] });
    }
    if (ended) throw new Error('The WebXR session ended during setup.');
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.enabled = true;
    scene.background = isAR ? null : originalBackground || new Color(0x101826);
    renderer.setClearAlpha(isAR ? 0 : 1);
    mounted = true;
    anchor.visible = false;
    scene.add(anchor);
    if (marker) scene.add(marker);
    anchor.add(assembly);
    if (courseControls) anchor.add(courseControls.group);
    assembly.visible = true;
    await renderer.xr.setSession(session);
    if (ended) throw new Error('The WebXR session ended during setup.');
    // Register after Three.js so its end listener restores the framebuffer first.
    session.removeEventListener('end', onSessionEnd);
    session.addEventListener('end', onSessionEnd, { once: true });
    reference = renderer.xr.getReferenceSpace();
    reference.addEventListener('reset', reset);
    session.addEventListener('select', select);
    overlayRoot?.addEventListener('beforexrselect', preventOverlayPlacement);
    ready = true;
    report(isAR ? 'scanning' : 'viewing');
    return { session, update, reset, end };
  } catch (error) {
    await end().catch(() => {});
    restore();
    throw error;
  }
}

function createSurfaceMarker() {
  const geometry = new RingGeometry(0.052, 0.066, 32).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: 0xffe083 });
  const marker = new Mesh(geometry, material);
  marker.visible = false;
  return marker;
}
