import React, { useRef, useCallback, useState, useEffect } from 'react';
import Map, {
  Layer,
  Source,
  FullscreenControl,
  NavigationControl,
  MapRef,
} from 'react-map-gl/maplibre';
import type {
  FilterSpecification,
  Map as MaplibreMap,
  MapDataEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import useActivities from '@/hooks/useActivities';
import {
  IS_CHINESE,
  ROAD_LABEL_DISPLAY,
  PROVINCE_FILL_COLOR,
  COUNTRY_FILL_COLOR,
  USE_DASH_LINE,
  LINE_OPACITY,
  MAP_HEIGHT,
  PRIVACY_MODE,
} from '@/utils/const';
import {
  Coordinate,
  IViewState,
  geoJsonForMap,
  getMapStyle,
  isTouchDevice,
} from '@/utils/utils';
import RunMarker from './RunMarker';
import RunMapButtons from './RunMapButtons';
import styles from './style.module.css';
import { FeatureCollection } from 'geojson';
import { RPGeometry } from '@/static/run_countries';
import LightsControl from '@/components/RunMap/LightsControl';

interface IRunMapProps {
  title: string;
  viewState: IViewState;
  setViewState: (_viewState: IViewState) => void;
  changeYear: (_year: string) => void;
  geoData: FeatureCollection<RPGeometry>;
  thisYear: string;
}

const MAP_TILE_VENDOR = 'maptiler';
const MAP_TILE_STYLE = 'dataviz-dark';
const MAP_TILE_ACCESS_TOKEN =
  import.meta.env.VITE_MAP_TILE_ACCESS_TOKEN?.trim() || 'Gt5R0jT8tuIYxW6sNrAg';
const MAP_TILE_FALLBACK_STYLE = 'https://demotiles.maplibre.org/style.json';

const RunMap = ({
  title,
  viewState,
  setViewState,
  changeYear,
  geoData,
  thisYear,
}: IRunMapProps) => {
  const { countries, provinces } = useActivities();
  const mapRef = useRef<MapRef | null>(null);
  const [lights, setLights] = useState(PRIVACY_MODE ? false : true);
  const keepWhenLightsOff = ['runs2'];
  const mapStyle = getMapStyle(
    MAP_TILE_VENDOR,
    MAP_TILE_STYLE,
    MAP_TILE_ACCESS_TOKEN
  );
  const [resolvedMapStyle, setResolvedMapStyle] = useState(mapStyle);
  const fallbackStyleApplied = useRef(false);

  useEffect(() => {
    fallbackStyleApplied.current = false;
    setResolvedMapStyle(mapStyle);
  }, [mapStyle]);

  const handleMapError = useCallback(
    (event: { error?: { message?: string; status?: number } }) => {
      if (
        fallbackStyleApplied.current ||
        resolvedMapStyle === MAP_TILE_FALLBACK_STYLE
      ) {
        return;
      }

      const message = `${event?.error?.message || ''}`;
      const status = event?.error?.status;
      const shouldFallback =
        status === 401 ||
        status === 403 ||
        /401|403|unauthorized|forbidden|style|sprite|glyph|tile|source/i.test(
          message
        );

      if (shouldFallback) {
        fallbackStyleApplied.current = true;
        setResolvedMapStyle(MAP_TILE_FALLBACK_STYLE);
      }
    },
    [resolvedMapStyle]
  );

  function switchLayerVisibility(map: MaplibreMap, lights: boolean) {
    const styleJson = map.getStyle();
    styleJson.layers.forEach((it: { id: string }) => {
      if (!keepWhenLightsOff.includes(it.id)) {
        if (lights) map.setLayoutProperty(it.id, 'visibility', 'visible');
        else map.setLayoutProperty(it.id, 'visibility', 'none');
      }
    });
  }

  function switchChineseLabels(map: MaplibreMap) {
    const style = map.getStyle();
    style.layers.forEach((layer: any) => {
      if (layer.type === 'symbol' && layer.layout?.['text-field']) {
        const tf = layer.layout['text-field'];
        // Replace name:en / name:latin with name (shows local language)
        if (typeof tf === 'string' && tf.includes('name:')) {
          map.setLayoutProperty(
            layer.id,
            'text-field',
            tf.replace(/name:\w+/g, 'name')
          );
        } else if (Array.isArray(tf)) {
          // Expression form: ['get', 'name:en'] or ['coalesce', ['get', 'name:en'], ...]
          const replaced = JSON.parse(
            JSON.stringify(tf).replace(/name:\w+/g, 'name')
          );
          map.setLayoutProperty(layer.id, 'text-field', replaced);
        }
      }
    });
  }

  const mapRefCallback = useCallback(
    (ref: MapRef | null) => {
      if (ref === null || mapRef.current) {
        return;
      }

      const map = ref.getMap();
      const onMapStyleReady = () => {
        if (!ROAD_LABEL_DISPLAY) {
          const layers = map.getStyle().layers;
          const labelLayerNames = layers
            .filter(
              (layer: any) =>
                (layer.type === 'symbol' || layer.type === 'composite') &&
                layer.layout?.['text-field'] != null
            )
            .map((layer: any) => layer.id);
          labelLayerNames.forEach((layerId) => {
            map.removeLayer(layerId);
          });
        }
        if (IS_CHINESE) {
          switchChineseLabels(map);
        }
        mapRef.current = ref;
        switchLayerVisibility(map, lights);
      };

      if (map.isStyleLoaded()) {
        onMapStyleReady();
        return;
      }

      const onData = (event: MapDataEvent) => {
        if (event.dataType !== 'style') {
          return;
        }
        map.off('data', onData);
        onMapStyleReady();
      };
      map.on('data', onData);
    },
    [mapRef, lights]
  );
  const filterProvinces: FilterSpecification = ['in', 'name', ...provinces];
  const filterCountries: FilterSpecification = ['in', 'name', ...countries];

  const initGeoDataLength = geoData.features.length;
  const isBigMap = (viewState.zoom ?? 0) <= 3;
  if (isBigMap && IS_CHINESE) {
    // Show boundary and line together, combine geoData(only when not combine yet)
    if (geoData.features.length === initGeoDataLength) {
      geoData = {
        type: 'FeatureCollection',
        features: geoData.features.concat(geoJsonForMap().features),
      };
    }
  }

  const isSingleRun =
    geoData.features.length === 1 &&
    geoData.features[0].geometry.coordinates.length;
  let startLon = 0;
  let startLat = 0;
  let endLon = 0;
  let endLat = 0;
  if (isSingleRun) {
    const points = geoData.features[0].geometry.coordinates as Coordinate[];
    [startLon, startLat] = points[0];
    [endLon, endLat] = points[points.length - 1];
  }
  let dash = USE_DASH_LINE && !isSingleRun && !isBigMap ? [2, 2] : [2, 0];
  const onMove = React.useCallback(
    ({ viewState }: { viewState: IViewState }) => {
      setViewState(viewState);
    },
    []
  );
  const style: React.CSSProperties = {
    width: '100%',
    height: MAP_HEIGHT,
  };
  const fullscreenButton: React.CSSProperties = {
    position: 'absolute',
    marginTop: '29.2px',
    right: '0px',
    opacity: 0.3,
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (mapRef.current) {
        mapRef.current.getMap().resize();
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      switchLayerVisibility(mapRef.current.getMap(), lights);
    }
  }, [lights]);

  return (
    <Map
      {...viewState}
      onMove={onMove}
      style={style}
      mapStyle={resolvedMapStyle}
      ref={mapRefCallback}
      cooperativeGestures={isTouchDevice()}
      onError={handleMapError}
    >
      <RunMapButtons changeYear={changeYear} thisYear={thisYear} />
      <Source id="data" type="geojson" data={geoData}>
        <Layer
          id="province"
          type="fill"
          paint={{
            'fill-color': PROVINCE_FILL_COLOR,
          }}
          filter={filterProvinces}
        />
        <Layer
          id="countries"
          type="fill"
          paint={{
            'fill-color': COUNTRY_FILL_COLOR,
            // in China, fill a bit lighter while already filled provinces
            'fill-opacity': ['case', ['==', ['get', 'name'], '中国'], 0.1, 0.5],
          }}
          filter={filterCountries}
        />
        <Layer
          id="runs2"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': isBigMap && lights ? 1 : 2,
            'line-dasharray': dash,
            'line-opacity':
              isSingleRun || isBigMap || !lights ? 1 : LINE_OPACITY,
            'line-blur': 1,
          }}
          layout={{
            'line-join': 'round',
            'line-cap': 'round',
          }}
        />
      </Source>
      {isSingleRun && (
        <RunMarker
          startLat={startLat}
          startLon={startLon}
          endLat={endLat}
          endLon={endLon}
        />
      )}
      <span className={styles.runTitle}>{title}</span>
      <FullscreenControl style={fullscreenButton} />
      {!PRIVACY_MODE && <LightsControl setLights={setLights} lights={lights} />}
      <NavigationControl
        showCompass={false}
        position={'bottom-right'}
        style={{ opacity: 0.3 }}
      />
    </Map>
  );
};

export default RunMap;
