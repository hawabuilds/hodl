import {ImageResponse} from "next/og";
import {APP_NAME, APP_TAGLINE} from "@/config/app";

export const alt = APP_NAME;
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#161A40",
          color: "#F5F6FF",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            marginBottom: 16,
          }}
        >
          {APP_NAME}
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 400,
            color: "#9EA2C8",
          }}
        >
          {APP_TAGLINE}
        </div>
      </div>
    ),
    size,
  );
}
