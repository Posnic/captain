export type MethodId = 'wifi' | 'qr' | 'cloud' | 'other' | 'code' | 'address' | 'settings';
export type Translate = (key: string) => string;
export function cloudRoles(options?: {translate?: Translate}): readonly {readonly id: 'owner' | 'staff'; readonly label: string; readonly description: string; readonly icon: string}[];
export interface Method { readonly id: MethodId; readonly label: string; readonly description?: string; readonly icon: string; readonly group: 'primary' | 'other'; readonly recommended: boolean }
export function methods(options?: {supported?: readonly MethodId[]; wifiAvailable?: boolean; translate?: Translate}): readonly Method[];
export interface WelcomeOptions {name: string; subtitle?: string; steps?: readonly string[]; translate?: Translate; copy?: {title?: string; eyebrow?: string; description?: string; continueLabel?: string}}
export function welcome(options: WelcomeOptions): {name: string; subtitle: string; title: string; eyebrow: string; description: string; steps: string[]; continueLabel: string};
/** SVG path data for web SVG or react-native-svg. The Posnic mark is a packaged SVG asset. */
export const icons: Readonly<Record<string, string>>;
