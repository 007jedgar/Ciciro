import { fireEvent, render, screen } from "@testing-library/react-native";
import { WritingReminderForm } from "../components/WritingReminderForm";
import { formatReminderClock, newWritingReminder, WEEKDAYS } from "../lib/writing-reminders";

const manuscripts = [
  { id: "p1", title: "Night Watch" },
  { id: "p2", title: "The Quiet Year" },
];

describe("WritingReminderForm", () => {
  it("starts general and changes the notification when a manuscript is chosen", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_1" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    expect(screen.getByText("Time to write")).toBeTruthy();
    expect(screen.getByText("250 words today.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All writing" }).props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(screen.getByRole("radio", { name: "Night Watch" }));

    expect(screen.getByText("Time to write Night Watch")).toBeTruthy();
    expect(screen.getByText("250 words on Night Watch.")).toBeTruthy();
    expect(screen.queryByText("250 words today.")).toBeNull();

    fireEvent.press(screen.getByLabelText("500 words"));
    expect(screen.getByText("500 words on Night Watch.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Save reminder"));

    expect(onSave).toHaveBeenCalledWith({
      id: "wr_1",
      projectId: "p1",
      wordGoal: 500,
      hour: 8,
      minute: 0,
      days: [...WEEKDAYS],
      enabled: true,
      openSprint: false,
    });
  });

  it("opens on the manuscript it was started from and can switch back to general", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_2", projectId: "p2" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    expect(screen.getByText("Time to write The Quiet Year")).toBeTruthy();
    expect(screen.getByText("250 words on The Quiet Year.")).toBeTruthy();

    fireEvent.press(screen.getByRole("radio", { name: "All writing" }));
    fireEvent.press(screen.getByLabelText("Save reminder"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: null, id: "wr_2" }));
    expect(screen.getByText("Time to write")).toBeTruthy();
    expect(screen.getByText("250 words today.")).toBeTruthy();
  });

  it("steps the time and requires at least one day", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_3" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    expect(screen.getByText(formatReminderClock(8, 0, "en"))).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Later"));
    expect(screen.getByText(formatReminderClock(8, 15, "en"))).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Earlier"));
    fireEvent.press(screen.getByLabelText("Earlier"));
    expect(screen.getByText(formatReminderClock(7, 45, "en"))).toBeTruthy();

    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      fireEvent.press(screen.getByLabelText(day));
    }
    fireEvent.press(screen.getByLabelText("Save reminder"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one day.");
  });

  it("saves a paused reminder and deletes only after a second press", () => {
    const onSave = jest.fn();
    const onDelete = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_4", projectId: "p1" })}
        manuscripts={manuscripts}
        onSave={onSave}
        onDelete={onDelete}
      />
    );

    fireEvent(screen.getByLabelText("Remind me"), "valueChange", false);
    expect(screen.getByText("Off for now. The phone will stay quiet.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Save reminder"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, projectId: "p1" }));

    fireEvent.press(screen.getByLabelText("Delete reminder"));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Delete this reminder"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not flash unavailable while manuscript titles are still loading", () => {
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_5", projectId: "p1" })}
        manuscripts={[]}
        manuscriptsReady={false}
        fallbackTitle="Night Watch"
        onSave={jest.fn()}
      />
    );

    expect(screen.queryByText("Manuscript unavailable")).toBeNull();
    expect(screen.getByText("Time to write Night Watch")).toBeTruthy();
    expect(screen.getByText("250 words on Night Watch.")).toBeTruthy();
    expect(screen.queryByText("250 words on your manuscript.")).toBeNull();
  });

  it("shows unavailable only after titles have settled without the manuscript", () => {
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_6", projectId: "gone" })}
        manuscripts={manuscripts}
        manuscriptsReady
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("Manuscript unavailable")).toBeTruthy();
    expect(screen.getByText("250 words on your manuscript.")).toBeTruthy();
  });
});
