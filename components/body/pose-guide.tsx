import type { BodyPose } from "@/lib/contracts/body-photos";

/**
 * The dashed outline to stand in (board 8): facing the camera or turned away for Front and Back,
 * a side view for Left and Right (mirrored for Right). Decorative; the pose is named in words.
 */
export const PoseGuide = ({ pose }: { pose: BodyPose }) => {
  const side = pose === "left" || pose === "right";
  return (
    <svg
      aria-hidden
      viewBox="0 0 190 430"
      className="h-[min(56dvh,26rem)] w-auto opacity-85"
      fill="none"
      stroke="#ffffff"
      strokeWidth={3}
      strokeDasharray="9 7"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="pose-guide"
      data-pose={pose}
    >
      {side ? (
        <g transform={pose === "right" ? "translate(190 0) scale(-1 1)" : undefined}>
          <circle cx="98" cy="42" r="28" />
          <path d="M92 70 C78 76 72 96 72 130 L70 200 L74 250 L76 410 M104 70 C120 78 124 100 122 130 L118 200 L112 250 L108 410" />
          <path d="M100 92 C96 120 94 160 96 232" />
          <path d="M76 410 h30" />
        </g>
      ) : (
        <>
          <circle cx="95" cy="42" r="30" />
          <path d="M68 82 C40 86 30 100 26 130 L14 240 M122 82 C150 86 160 100 164 130 L176 240" />
          <path d="M68 82 L64 200 L60 250 L56 410 M122 82 L126 200 L130 250 L134 410" />
          <path d="M64 200 L126 200 M95 250 L95 410" />
        </>
      )}
    </svg>
  );
};
