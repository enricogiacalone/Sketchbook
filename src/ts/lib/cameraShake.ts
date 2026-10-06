export const globalCameraShake = {
  intensity: 0,
  trigger(amount: number = 0.5) {
    this.intensity = Math.max(this.intensity, amount);
  },
};

export const triggerCameraShake = (amount: number = 0.5) => {
  globalCameraShake.trigger(amount);
};
