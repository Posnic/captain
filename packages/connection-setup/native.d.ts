import type {ReactNode, ReactElement} from 'react';
import type {ImageSourcePropType} from 'react-native';
import type {MethodId, Translate, WelcomeOptions} from './index';
export interface Theme {surface: string; ink: string; muted: string; line: string; tint: string; accent: string; accentInk: string}
export function ConnectionMethods(props: {supported?: readonly MethodId[]; wifiAvailable?: boolean; translate?: Translate; onSelect: (method: MethodId)=>void; renderIcon: (name: string, color: string, size: number)=>ReactNode; theme?: Partial<Theme>}): ReactElement;
/** Host supplies a ScrollView/safe area and its own raster/native logo source. */
export function ConnectionWelcome(props: WelcomeOptions & {logo: ImageSourcePropType; onContinue: ()=>void; theme?: Partial<Theme>}): ReactElement;
