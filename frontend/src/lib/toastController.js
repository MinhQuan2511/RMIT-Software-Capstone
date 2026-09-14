/**
 * Toast lifecycle without stale timers.
 *
 * Defects in the previous component: the 350 ms exit timer was never
 * cancelled, so a toast shown just after another closed was hidden by the old
 * timer; and a second message while one was open never reset the 4 s timer,
 * so it closed early. Here every show() cancels both timers and every timer
 * callback checks it still belongs to the current toast.
 */

export const TOAST_VISIBLE_MS = 4000;
export const TOAST_ERROR_VISIBLE_MS = 8000;
export const TOAST_EXIT_MS = 350;

export function createToastController({ onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = { toast: null, phase: "hidden" };
  let hideTimer = null;
  let exitTimer = null;
  let seq = 0;

  const emit = () => onChange(state);
  const clearAll = () => {
    if (hideTimer !== null) clearTimer(hideTimer);
    if (exitTimer !== null) clearTimer(exitTimer);
    hideTimer = null;
    exitTimer = null;
  };

  const api = {
    show(title, message, type = "success") {
      clearAll();
      seq += 1;
      const id = seq;
      state = { toast: { id, title, message, type }, phase: "visible" };
      emit();
      hideTimer = setTimer(() => { hideTimer = null; api.dismiss(id); }, type === "error" ? TOAST_ERROR_VISIBLE_MS : TOAST_VISIBLE_MS);
      return id;
    },
    dismiss(id) {
      if (!state.toast || (id !== undefined && state.toast.id !== id) || state.phase === "exiting") return;
      const current = state.toast.id;
      if (hideTimer !== null) { clearTimer(hideTimer); hideTimer = null; }
      state = { ...state, phase: "exiting" };
      emit();
      exitTimer = setTimer(() => {
        exitTimer = null;
        if (state.toast && state.toast.id === current) {
          state = { toast: null, phase: "hidden" };
          emit();
        }
      }, TOAST_EXIT_MS);
    },
    destroy() {
      clearAll();
    },
    getState: () => state,
  };
  return api;
}
