import React, {
  Component,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import styled from "styled-components";
import api from "shared/api";
import { Context } from "shared/Context";
import { ChartType } from "shared/types";
import ResourceTab from "components/ResourceTab";
import ConfirmOverlay from "components/ConfirmOverlay";
import { NewWebsocketOptions, useWebsockets } from "shared/hooks/useWebsockets";
import PodRow from "./PodRow";

type PropsType = {
  controller: any;
  selectedPod: any;
  selectPod: Function;
  selectors: any;
  isLast?: boolean;
  isFirst?: boolean;
  setPodError: (x: string) => void;
};

type StateType = {
  pods: any[];
  raw: any[];
  showTooltip: boolean[];
  podPendingDelete: any;
  websockets: Record<string, any>;
  selectors: string[];
  available: number;
  total: number;
  canUpdatePod: boolean;
};

// Controller tab in log section that displays list of pods on click.
export type ControllerTabPodType = {
  namespace: string;
  name: string;
  phase: string;
  status: any;
  replicaSetName: string;
};

const ControllerTabFC: React.FunctionComponent<PropsType> = ({
  controller,
  selectPod,
  isFirst,
  isLast,
  selectors,
  setPodError,
  selectedPod,
}) => {
  const [pods, setPods] = useState<ControllerTabPodType[]>([]);
  const [rawPodList, setRawPodList] = useState<any[]>([]);
  const [podPendingDelete, setPodPendingDelete] = useState<any>(null);
  const [available, setAvailable] = useState<number>(null);
  const [total, setTotal] = useState<number>(null);
  const [userSelectedPod, setUserSelectedPod] = useState<boolean>(false);

  const { currentCluster, currentProject, setCurrentError } = useContext(
    Context
  );
  const {
    newWebsocket,
    openWebsocket,
    closeAllWebsockets,
    closeWebsocket,
  } = useWebsockets();

  const currentSelectors = useMemo(() => {
    if (controller.kind.toLowerCase() == "job" && selectors) {
      return [...selectors];
    }
    let newSelectors = [] as string[];
    let ml =
      controller?.spec?.selector?.matchLabels || controller?.spec?.selector;
    let i = 1;
    let selector = "";
    for (var key in ml) {
      selector += key + "=" + ml[key];
      if (i != Object.keys(ml).length) {
        selector += ",";
      }
      i += 1;
    }
    newSelectors.push(selector);
    return [...newSelectors];
  }, [controller, selectors]);

  const updatePods = async () => {
    try {
      const res = await api.getMatchingPods(
        "<token>",
        {
          cluster_id: currentCluster.id,
          namespace: controller?.metadata?.namespace,
          selectors: currentSelectors,
        },
        {
          id: currentProject.id,
        }
      );
      const data = res?.data as any[];
      let newPods = data
        // Parse only data that we need
        .map<ControllerTabPodType>((pod: any) => {
          const replicaSetName =
            Array.isArray(pod?.metadata?.ownerReferences) &&
            pod?.metadata?.ownerReferences[0]?.name;
          return {
            namespace: pod?.metadata?.namespace,
            name: pod?.metadata?.name,
            phase: pod?.status?.phase,
            status: pod?.status,
            replicaSetName,
          };
        });

      setPods(newPods);
      setRawPodList(data);
      if (!userSelectedPod) {
        let status = getPodStatus(newPods[0].status);
        status === "failed" &&
          newPods[0].status?.message &&
          setPodError(newPods[0].status?.message);
        handleSelectPod(newPods[0], data);
      }
    } catch (error) {}
  };

  const handleSelectPod = (pod: ControllerTabPodType, rawList?: any[]) => {
    console.log(rawPodList);
    const rawPod = [...rawPodList, ...(rawList || [])].find(
      (rawPod) => rawPod?.metadata?.name === pod?.name
    );
    selectPod(rawPod);
  };

  const currentSelectedPod = useMemo(() => {
    const pod = selectedPod;
    const replicaSetName =
      Array.isArray(pod?.metadata?.ownerReferences) &&
      pod?.metadata?.ownerReferences[0]?.name;
    return {
      namespace: pod?.metadata?.namespace,
      name: pod?.metadata?.name,
      phase: pod?.status?.phase,
      status: pod?.status,
      replicaSetName,
    } as ControllerTabPodType;
  }, [selectedPod]);

  useEffect(() => {
    updatePods();
    [controller?.kind, "pod"].forEach((kind) => {
      setupWebsocket(kind, controller?.metadata?.uid);
    });
    () => closeAllWebsockets();
  }, [currentSelectors, controller, currentCluster, currentProject]);

  const currentControllerStatus = useMemo(() => {
    let status = available == total ? "running" : "waiting";

    controller?.status?.conditions?.forEach((condition: any) => {
      if (
        condition.type == "Progressing" &&
        condition.status == "False" &&
        condition.reason == "ProgressDeadlineExceeded"
      ) {
        status = "failed";
      }
    });

    if (controller.kind.toLowerCase() === "job" && pods.length == 0) {
      status = "completed";
    }
    return status;
  }, [controller, available, total, pods]);

  const getPodStatus = (status: any) => {
    if (
      status?.phase === "Pending" &&
      status?.containerStatuses !== undefined
    ) {
      return status.containerStatuses[0].state.waiting.reason;
    } else if (status?.phase === "Pending") {
      return "Pending";
    }

    if (status?.phase === "Failed") {
      return "failed";
    }

    if (status?.phase === "Running") {
      let collatedStatus = "running";

      status?.containerStatuses?.forEach((s: any) => {
        if (s.state?.waiting) {
          collatedStatus =
            s.state?.waiting.reason === "CrashLoopBackOff"
              ? "failed"
              : "waiting";
        } else if (s.state?.terminated) {
          collatedStatus = "failed";
        }
      });
      return collatedStatus;
    }
  };

  const handleDeletePod = (pod: any) => {
    api
      .deletePod(
        "<token>",
        {
          cluster_id: currentCluster.id,
        },
        {
          name: pod.metadata?.name,
          namespace: pod.metadata?.namespace,
          id: currentProject.id,
        }
      )
      .then((res) => {
        updatePods();
        setPodPendingDelete(null);
      })
      .catch((err) => {
        setCurrentError(JSON.stringify(err));
        setPodPendingDelete(null);
      });
  };

  const replicaSetArray = useMemo(() => {
    const podsDividedByReplicaSet = pods.reduce<
      Array<Array<ControllerTabPodType>>
    >(function (prev, currentPod, i) {
      if (
        !i ||
        prev[prev.length - 1][0].replicaSetName !== currentPod.replicaSetName
      ) {
        return prev.concat([[currentPod]]);
      }
      prev[prev.length - 1].push(currentPod);
      return prev;
    }, []);

    if (podsDividedByReplicaSet.length === 1) {
      return [];
    } else {
      return podsDividedByReplicaSet;
    }
  }, [pods]);

  const getAvailability = (kind: string, c: any) => {
    switch (kind?.toLowerCase()) {
      case "deployment":
      case "replicaset":
        return [
          c.status?.availableReplicas ||
            c.status?.replicas - c.status?.unavailableReplicas ||
            0,
          c.status?.replicas || 0,
        ];
      case "statefulset":
        return [c.status?.readyReplicas || 0, c.status?.replicas || 0];
      case "daemonset":
        return [
          c.status?.numberAvailable || 0,
          c.status?.desiredNumberScheduled || 0,
        ];
      case "job":
        return [1, 1];
    }
  };

  const setupWebsocket = (kind: string, controllerUid: string) => {
    let apiEndpoint = `/api/projects/${currentProject.id}/k8s/${kind}/status?cluster_id=${currentCluster.id}`;
    if (kind == "pod" && currentSelectors) {
      apiEndpoint += `&selectors=${currentSelectors[0]}`;
    }

    const options: NewWebsocketOptions = {};
    options.onopen = () => {
      console.log("connected to websocket");
    };

    options.onmessage = (evt: MessageEvent) => {
      let event = JSON.parse(evt.data);
      let object = event.Object;
      object.metadata.kind = event.Kind;

      // update pods no matter what if ws message is a pod event.
      // If controller event, check if ws message corresponds to the designated controller in props.
      if (event.Kind != "pod" && object.metadata.uid !== controllerUid) return;

      if (event.Kind != "pod") {
        let [available, total] = getAvailability(object.metadata.kind, object);
        setAvailable(available);
        setTotal(total);
      }
      updatePods();
    };

    options.onclose = () => {
      console.log("closing websocket");
    };

    options.onerror = (err: ErrorEvent) => {
      console.log(err);
      closeWebsocket(kind);
    };

    newWebsocket(kind, apiEndpoint, options);
    openWebsocket(kind);
  };

  return (
    <ResourceTab
      label={controller.kind}
      // handle CronJob case
      name={controller.metadata?.name || controller.name}
      status={{ label: currentControllerStatus, available, total }}
      isLast={isLast}
      expanded={isFirst}
    >
      {pods.map((pod, i) => {
        let status = getPodStatus(pod.status);
        return (
          <PodRow
            key={i}
            pod={pod}
            isSelected={currentSelectedPod?.name === pod?.name}
            podStatus={status}
            isLastItem={i === pods.length - 1}
            onTabClick={() => {
              setPodError("");
              status === "failed" &&
                pod.status?.message &&
                setPodError(pod.status?.message);
              handleSelectPod(pod);
              setUserSelectedPod(true);
            }}
            onDeleteClick={() => setPodPendingDelete(pod)}
          />
        );
      })}
      <ConfirmOverlay
        message="Are you sure you want to delete this pod?"
        show={podPendingDelete}
        onYes={() => handleDeletePod(podPendingDelete)}
        onNo={() => setPodPendingDelete(null)}
      />
    </ResourceTab>
  );
};

export default ControllerTabFC;

const CloseIcon = styled.i`
  font-size: 14px;
  display: flex;
  font-weight: bold;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #ffffff22;
  width: 18px;
  height: 18px;
  margin-right: -6px;
  margin-left: 10px;
  cursor: pointer;
  :hover {
    background: #ffffff44;
  }
`;

const Tooltip = styled.div`
  position: absolute;
  left: 35px;
  word-wrap: break-word;
  top: 38px;
  min-height: 18px;
  max-width: calc(100% - 75px);
  padding: 2px 5px;
  background: #383842dd;
  display: flex;
  justify-content: center;
  flex: 1;
  color: white;
  text-transform: none;
  font-size: 12px;
  font-family: "Work Sans", sans-serif;
  outline: 1px solid #ffffff55;
  opacity: 0;
  animation: faded-in 0.2s 0.15s;
  animation-fill-mode: forwards;
  @keyframes faded-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;
