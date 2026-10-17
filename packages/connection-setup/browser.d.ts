import type {Method, MethodId, Translate, WelcomeOptions} from './index';
export function decorateMethod(button: HTMLButtonElement, method: Method, options?: {posnicLogo?: string}): HTMLButtonElement;
/** Returns a cleanup function. Selection invokes the host adapter; it does not authenticate. */
export function mountMethods(container: HTMLElement, options: {onSelect: (method: MethodId)=>void; posnicLogo?: string; supported?: readonly MethodId[]; wifiAvailable?: boolean; translate?: Translate}): ()=>void;
export function renderWelcome(container: HTMLElement, options: WelcomeOptions & {logo: string; onContinue: ()=>void}): ()=>void;
