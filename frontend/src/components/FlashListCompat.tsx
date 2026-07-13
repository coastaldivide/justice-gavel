/**
 * FlashListCompat — FlatList drop-in powered by FlashList
 * Accepts all FlatList props; strips incompatible ones before passing to FlashList.
 */
import React from 'react';
import { FlashList } from '@shopify/flash-list';

export function FlashListCompat(props: any) {
  const {
    getItemLayout: _a,
    removeClippedSubviews: _b,
    maxToRenderPerBatch: _c,
    windowSize: _d,
    initialNumToRender: _e,
    keyboardShouldPersistTaps: _f,
    updateCellsBatchingPeriod: _g,
    estimatedItemSize = 80,
    ...rest
  } = props;
  return <FlashList estimatedItemSize={estimatedItemSize} {...rest} />;
}

export default FlashListCompat;
