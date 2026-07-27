import { exerciseCyclePatchVisibilityFaultCampaign } from "./cycle_patch_visibility_fault.mjs";

/** Execute the H03D checkpoint-only PatchAccepted fault tranche. */
export async function exerciseCyclePatchCheckpointFaultCampaign(options) {
  return exerciseCyclePatchVisibilityFaultCampaign(options);
}
