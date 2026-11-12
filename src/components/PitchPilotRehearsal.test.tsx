import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { PitchPilotRehearsal } from "./PitchPilotRehearsal";

function renderRehearsal(overrides: Partial<ComponentProps<typeof PitchPilotRehearsal>> = {}) {
  const onStart = jest.fn().mockResolvedValue(undefined);
  const onStop = jest.fn().mockResolvedValue(undefined);
  const onOpenAnalytics = jest.fn();
  render(<PitchPilotRehearsal
    prompt="Practice the opening."
    signal="waiting"
    onStart={onStart}
    onStop={onStop}
    onOpenAnalytics={onOpenAnalytics}
    {...overrides}
  />);
  return { onStart, onStop, onOpenAnalytics };
}

describe("PitchPilotRehearsal consent and controls", () => {
  test("keeps start disabled until camera consent and leaves microphone opt-in unchecked", async () => {
    const user = userEvent.setup();
    const { onStart } = renderRehearsal();
    const startButton = screen.getByRole("button", { name: /start rehearsal/i });
    const cameraConsent = screen.getByRole("checkbox", { name: /agree to turn on my camera/i });
    const microphoneConsent = screen.getByRole("checkbox", { name: /also record my microphone locally/i });

    expect(startButton).toBeDisabled();
    expect(cameraConsent).not.toBeChecked();
    expect(microphoneConsent).not.toBeChecked();

    await user.click(cameraConsent);
    expect(startButton).toBeEnabled();
    await user.click(startButton);
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(false));
    expect(await screen.findByRole("heading", { name: "Your rehearsal" })).toBeInTheDocument();
  });

  test("passes microphone consent only after the separate optional checkbox is selected", async () => {
    const user = userEvent.setup();
    const { onStart } = renderRehearsal();
    await user.click(screen.getByRole("checkbox", { name: /agree to turn on my camera/i }));
    await user.click(screen.getByRole("checkbox", { name: /also record my microphone locally/i }));
    await user.click(screen.getByRole("button", { name: /start rehearsal/i }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(true));
  });

  test("provides analytics navigation and disables export until rows exist", async () => {
    const user = userEvent.setup();
    const { onOpenAnalytics } = renderRehearsal();
    expect(screen.getByRole("button", { name: "Export performance CSV" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Analytics" }));
    expect(onOpenAnalytics).toHaveBeenCalledTimes(1);
  });

  test("shows export control once in-memory log rows are available", () => {
    renderRehearsal({ hasExportData: true });
    expect(screen.getByRole("button", { name: "Export performance CSV" })).toBeEnabled();
  });
});
