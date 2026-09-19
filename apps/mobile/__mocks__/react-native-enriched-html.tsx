import { forwardRef, useImperativeHandle, useRef, type Ref } from "react";
import { TextInput } from "react-native";

function noop() {}

export const EnrichedTextInput = forwardRef(function EnrichedTextInput(
  props: {
    testID?: string;
    defaultValue?: string;
    onFocus?: (e: unknown) => void;
    onBlur?: (e: unknown) => void;
    onChangeText?: (e: { nativeEvent: { value: string } }) => void;
    onChangeState?: (e: { nativeEvent: unknown }) => void;
    onChangeSelection?: (e: { nativeEvent: { start: number; end: number; text: string } }) => void;
  },
  ref: Ref<unknown>
) {
  const html = useRef(props.defaultValue ?? "");
  const api = useRef({
    focus: noop,
    blur: noop,
    setValue: (value: string) => {
      html.current = value;
    },
    setSelection: noop,
    getHTML: async () => html.current,
    toggleBold: noop,
    toggleItalic: noop,
    toggleUnderline: noop,
    toggleStrikeThrough: noop,
    toggleInlineCode: noop,
    toggleH1: noop,
    toggleH2: noop,
    toggleH3: noop,
    toggleH4: noop,
    toggleH5: noop,
    toggleH6: noop,
    toggleCodeBlock: noop,
    toggleBlockQuote: noop,
    toggleOrderedList: noop,
    toggleUnorderedList: noop,
    toggleCheckboxList: noop,
    setLink: noop,
    removeLink: noop,
    setImage: noop,
    startMention: noop,
    setMention: noop,
    setTextAlignment: noop,
  });
  useImperativeHandle(ref, () => api.current, []);
  return (
    <TextInput
      testID={props.testID}
      defaultValue={props.defaultValue}
      multiline
      onFocus={props.onFocus as never}
      onBlur={props.onBlur as never}
      onChangeText={(value) => {
        html.current = value;
        props.onChangeText?.({ nativeEvent: { value } });
      }}
    />
  );
});

export const EnrichedText = () => null;
