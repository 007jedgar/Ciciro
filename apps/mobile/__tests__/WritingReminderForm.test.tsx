import { fireEvent, render, screen } from "@testing-library/react-native";
import { WritingReminderForm } from "../components/WritingReminderForm";
import { newWritingReminder, WEEKDAYS } from "../lib/writing-reminders";

// The native picker has no JS surface to drive; a stand-in that forwards `onChange` keeps the
// form's own handling (hour/minute read-back, dismissed events) under test.
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: (props: object) => <View {...props} /> };
});

/** A reminder that carries a word goal (a new one has none). */
const withGoal = (input: Parameters<typeof newWritingReminder>[0], wordGoal = 250) => ({
  ...newWritingReminder(input),
  wordGoal,
});

const manuscripts = [
  { id: "p1", title: "Night Watch" },
  { id: "p2", title: "The Quiet Year" },
];

describe("WritingReminderForm", () => {
  it("starts general with no word goal and changes the notification when a manuscript is chosen", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_1" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    expect(screen.getByText("Time to write")).toBeTruthy();
    expect(screen.getByText("Even a few words count today.")).toBeTruthy();
    expect(screen.getByText("Word goal (optional)")).toBeTruthy();
    expect(screen.getByLabelText("No goal").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole("radio", { name: "All writing" }).props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(screen.getByRole("radio", { name: "Night Watch" }));

    expect(screen.getByText("Time to write Night Watch")).toBeTruthy();
    expect(screen.getByText("A little time on Night Watch.")).toBeTruthy();
    expect(screen.queryByText("Even a few words count today.")).toBeNull();

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

  it("saves with no word goal, and can clear one back to none", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_8" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    fireEvent.press(screen.getByLabelText("Save reminder"));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ id: "wr_8", wordGoal: null }));

    fireEvent.press(screen.getByLabelText("250 words"));
    expect(screen.getByText("250 words today.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("No goal"));
    expect(screen.getByText("Even a few words count today.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Save reminder"));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ wordGoal: null }));
  });

  it("keeps a saved goal when editing and lists a custom one", () => {
    render(
      <WritingReminderForm
        reminder={withGoal({ id: "wr_9" }, 300)}
        manuscripts={manuscripts}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("300 words today.")).toBeTruthy();
    expect(screen.getByLabelText("300 words").props.accessibilityState).toEqual({ selected: true });
  });

  it("opens on the manuscript it was started from and can switch back to general", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={withGoal({ id: "wr_2", projectId: "p2" })}
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

  it("picks a time with the native picker and requires at least one day", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_3" })}
        manuscripts={manuscripts}
        onSave={onSave}
      />
    );

    const picker = screen.getByTestId("reminder-time-picker");
    expect(picker.props.mode).toBe("time");
    expect(picker.props.value.getHours()).toBe(8);
    expect(picker.props.value.getMinutes()).toBe(0);

    fireEvent(picker, "change", { type: "set" }, new Date(2020, 0, 1, 21, 37));
    expect(screen.getByTestId("reminder-time-picker").props.value.getHours()).toBe(21);
    expect(screen.getByTestId("reminder-time-picker").props.value.getMinutes()).toBe(37);

    fireEvent.press(screen.getByLabelText("Save reminder"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ hour: 21, minute: 37 }));
    onSave.mockClear();

    for (const day of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      fireEvent.press(screen.getByLabelText(day));
    }
    fireEvent.press(screen.getByLabelText("Save reminder"));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one day.");
  });

  it("ignores a dismissed picker and offers the suggested hour", () => {
    const onSave = jest.fn();
    render(
      <WritingReminderForm
        reminder={newWritingReminder({ id: "wr_7" })}
        manuscripts={manuscripts}
        suggestedHour={20}
        onSave={onSave}
      />
    );

    fireEvent(screen.getByTestId("reminder-time-picker"), "change", { type: "dismissed" }, undefined);
    fireEvent.press(screen.getByLabelText("Save reminder"));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ hour: 8, minute: 0 }));

    fireEvent.press(screen.getByLabelText("Use this time"));
    const picker = screen.getByTestId("reminder-time-picker");
    expect(picker.props.value.getHours()).toBe(20);
    expect(picker.props.value.getMinutes()).toBe(0);
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
        reminder={withGoal({ id: "wr_5", projectId: "p1" })}
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
        reminder={withGoal({ id: "wr_6", projectId: "gone" })}
        manuscripts={manuscripts}
        manuscriptsReady
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("Manuscript unavailable")).toBeTruthy();
    expect(screen.getByText("250 words on your manuscript.")).toBeTruthy();
  });
});
