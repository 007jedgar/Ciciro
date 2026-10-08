import { useEffect } from "react";
import { Text, type TextProps } from "react-native";
import { announce } from "../lib/announce";

/**
 * Text that tells the author something went wrong. It is announced as it
 * appears: iOS does not read `role="alert"` by itself, and the error often
 * sits outside the element VoiceOver is focused on.
 */
export function AlertText({ children, ...rest }: TextProps) {
  const message = typeof children === "string" ? children : null;
  useEffect(() => {
    announce(message);
  }, [message]);
  return (
    <Text role="alert" {...rest}>
      {children}
    </Text>
  );
}
