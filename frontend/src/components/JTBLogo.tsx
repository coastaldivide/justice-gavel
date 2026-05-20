/**
 * JTBLogo — Justice Gavel official brand mark (v3, permanent)
 *
 * Octagon in navy (#042C53) with gold outer border (#F9A825),
 * steel blue inner ring (#185FA5), JUSTICE in white, GAVEL in gold.
 *
 * This is the standing, permanent logo. Do not alter the design.
 * size prop controls the square dimension in pixels.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, {
  Polygon, Rect, Text as SvgText, Line
} from 'react-native-svg';

interface Props {
  size?: number;
}

function JTBLogo({ size = 80 }: Props) {
  const s = size;
  // Scale all coordinates from the 680×680 master viewBox
  const sc = (v: number) => (v / 680) * s;

  // Octagon points from the 680×680 master
  const oct = '448,141 579,211 579,469 448,539 232,539 101,469 101,211 232,141';
  const octInner = '448,141 579,211 579,469 448,539 232,539 101,469 101,211 232,141';

  return (
    <View style={{ width: s, height: s }}>
      <Svg width={s} height={s} viewBox="0 0 680 680">
        {/* Background */}
        <Rect x={0} y={0} width={680} height={680} fill="#042C53" />

        {/* Outer octagon — navy fill, gold stroke */}
        <Polygon
          points={oct}
          fill="#042C53"
          stroke="#F9A825"
          strokeWidth={8}
        />

        {/* Inner octagon — steel blue border ring (scaled 88%) */}
        <Polygon
          points={octInner}
          fill="none"
          stroke="#185FA5"
          strokeWidth={3}
          transform="scale(0.88) translate(46,46)"
        />

        {/* JUSTICE */}
        <SvgText
          x={340}
          y={318}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize={72}
          fontWeight="700"
          fill="#FFFFFF"
          letterSpacing={6}
        >JUSTICE</SvgText>

        {/* Gold rule */}
        <Line x1={180} y1={340} x2={500} y2={340} stroke="#F9A825" strokeWidth={2.5} />

        {/* GAVEL */}
        <SvgText
          x={340}
          y={388}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize={72}
          fontWeight="700"
          fill="#F9A825"
          letterSpacing={6}
        >GAVEL</SvgText>
      </Svg>
    </View>
  );
}

export default React.memo(JTBLogo);
