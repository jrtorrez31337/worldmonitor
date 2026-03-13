export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createWebcamServiceRoutes } from '../../../src/generated/server/worldmonitor/webcam/v1/service_server';
import { webcamHandler } from '../../../server/worldmonitor/webcam/v1/handler';
import { handleRefresh } from '../../../server/worldmonitor/webcam/v1/refresh-webcams';

const refreshRoute = {
  method: 'POST',
  path: '/api/webcam/v1/refresh-webcams',
  handler: handleRefresh,
};

const refreshStatusRoute = {
  method: 'GET',
  path: '/api/webcam/v1/refresh-webcams',
  handler: handleRefresh,
};

export default createDomainGateway([
  ...createWebcamServiceRoutes(webcamHandler, serverOptions),
  refreshRoute,
  refreshStatusRoute,
]);
