/**
 * FlashListCompat — FlatList drop-in powered by FlashList
 * Accepts all FlashList props plus the FlatList-only virtualization props
 * screens still pass; strips the incompatible ones before rendering FlashList.
 */
import React from 'react';
import type { FlatListProps } from 'react-native';
import { FlashList, FlashListProps } from '@shopify/flash-list';

/** FlatList-only props FlashList does not accept — stripped before render. */
type FlatListOnlyProps<T> = Partial<Pick<FlatListProps<T>,
  | 'getItemLayout'
  | 'removeClippedSubviews'
  | 'maxToRenderPerBatch'
  | 'windowSize'
  | 'initialNumToRender'
  | 'updateCellsBatchingPeriod'
>>;

export type FlashListCompatProps<T> = FlashListProps<T> & FlatListOnlyProps<T>;

export function FlashListCompat<T>(props: FlashListCompatProps<T>): React.JSX.Element {
  const {
    getItemLayout: _a,
    removeClippedSubviews: _b,
    maxToRenderPerBatch: _c,
    windowSize: _d,
    initialNumToRender: _e,
    updateCellsBatchingPeriod: _f,
    estimatedItemSize = 80,
    ...rest
  } = props;
  return <FlashList<T> estimatedItemSize={estimatedItemSize} {...rest} />;
}

export default FlashListCompat;
