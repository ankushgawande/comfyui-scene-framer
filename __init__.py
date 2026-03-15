"""
Scene Framer  v7
=================
CRITICAL FIX: shot_data must be "required" not "hidden".
ComfyUI "hidden" inputs do NOT reliably pass to process().
JS hides the widget visually via computeSize = [0,-4].
"""

import torch
import numpy as np
import json

MAX_SHOTS = 8


class SceneFramer:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "background_image": ("IMAGE",),
                # This MUST be required — hidden inputs don't pass to process()
                # JS sets computeSize=[0,-4] to make it invisible
                "shot_data": ("STRING", {"default": "[]", "multiline": False}),
            },
        }

    RETURN_TYPES  = ("IMAGE",) * MAX_SHOTS
    RETURN_NAMES  = tuple(f"shot_{i+1}" for i in range(MAX_SHOTS))
    FUNCTION      = "process"
    CATEGORY      = "Scene Framer"

    def process(self, background_image, shot_data="[]"):
        img = background_image[0].float().cpu().numpy()
        H, W = img.shape[:2]

        try:
            shots = json.loads(shot_data) if shot_data.strip() else []
        except Exception:
            shots = []

        print(f"[Scene Framer] Processing {len(shots)} shots, image {W}x{H}")

        blank = torch.zeros(1, 1, 1, 3, dtype=torch.float32)
        outputs = []

        for i in range(MAX_SHOTS):
            if i < len(shots) and shots[i].get("active", False):
                s    = shots[i]
                x    = max(0, min(int(s.get("x", 0)),  W - 1))
                y    = max(0, min(int(s.get("y", 0)),  H - 1))
                cw   = max(1, min(int(s.get("w", W)),  W - x))
                ch   = max(1, min(int(s.get("h", H)),  H - y))
                crop = img[y:y+ch, x:x+cw].copy()

                ow = int(s.get("out_w", cw))
                oh = int(s.get("out_h", ch))

                if ow != cw or oh != ch:
                    try:
                        from PIL import Image as PILImage
                        p    = PILImage.fromarray((crop*255).clip(0,255).astype(np.uint8))
                        p    = p.resize((ow, oh), PILImage.LANCZOS)
                        crop = np.array(p).astype(np.float32) / 255.0
                    except ImportError:
                        pass

                name = s.get("name", f"Shot_{i+1}")
                print(f"[Scene Framer]   {name}: ({x},{y}) {cw}x{ch} -> {ow}x{oh}")
                outputs.append(torch.from_numpy(np.ascontiguousarray(crop)).unsqueeze(0))
            else:
                outputs.append(blank)

        return tuple(outputs)


NODE_CLASS_MAPPINGS        = {"SceneFramer": SceneFramer}
NODE_DISPLAY_NAME_MAPPINGS = {"SceneFramer": "Scene Framer"}
WEB_DIRECTORY              = "./js"
__all__                    = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
