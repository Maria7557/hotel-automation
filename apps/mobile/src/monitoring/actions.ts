import { createActionRunner } from "@hotel/monitoring/actions";
import { monitor } from "./index";

export const actions = createActionRunner(monitor);
export const monitoredAction = actions.handler;
